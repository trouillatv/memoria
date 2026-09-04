import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('historical import post-processing orchestration', () => {
  it('répond après la matérialisation principale et planifie la mémoire avec after()', () => {
    const source = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    const materialize = source.indexOf('materializeHistoricalVisit({')
    const finalizeRun = source.indexOf(".update({ status: 'materialized' })")
    const schedule = source.indexOf('after(() => runHistoricalImportPostProcessing({')
    const success = source.indexOf("message: 'Visite créée. La mise à jour de la mémoire se poursuit.'")

    expect(materialize).toBeGreaterThan(-1)
    expect(finalizeRun).toBeGreaterThan(materialize)
    expect(schedule).toBeGreaterThan(finalizeRun)
    expect(success).toBeGreaterThan(schedule)
    expect(source.slice(materialize, schedule)).not.toMatch(/reconcileHistoricalCorpusForSite\(/)
  })

  it('le retry manuel et le sweep réutilisent le même orchestrateur', () => {
    const actions = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    const sweep = read('lib/db/reconciliation-sweep.ts')
    expect(actions.match(/runHistoricalImportPostProcessing/g)).toHaveLength(3) // import + création + retry
    expect(sweep).toMatch(/runHistoricalImportPostProcessing/)
  })

  it('l’orchestrateur ne rappelle jamais la matérialisation principale', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    expect(source).not.toMatch(/materializeHistoricalVisit/)
    expect(source).not.toMatch(/visit_capture/)
    expect(source).toMatch(/decideReconcileLock/)
    expect(source).toMatch(/runHistoricalMemoryBuildPipeline/)
  })

  it('branche le pont documentaire proposal-level (P1-4B-WIRING), pas occurrence-level', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    // Nouvelle vérité de production = unité de preuve proposition atomique.
    expect(source).toMatch(/resolveSiteDocumentCompletionsByProposal\(siteId\)/)
    // Le chemin occurrence-level ne doit plus être appelé pour les nouveaux imports.
    expect(source).not.toMatch(/\bresolveSiteDocumentCompletions\(siteId\)/)
    // Appelé après canonicalisation + attach des CBO (les candidats doivent exister).
    const attach = source.indexOf('attachHistoricalReportEntitiesToCanonicalBusinessObjects({ siteId')
    const resolve = source.indexOf('resolveSiteDocumentCompletionsByProposal(siteId)')
    expect(attach).toBeGreaterThan(-1)
    expect(resolve).toBeGreaterThan(attach)
    // Best-effort : n'écrit jamais de signal lifecycle.
    expect(source).not.toMatch(/object_state_occurrence_signal/)
  })
})
