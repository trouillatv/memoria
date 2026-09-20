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
    expect(source).not.toMatch(/\bmaterializeHistoricalVisit\(/)
    expect(source).not.toMatch(/visit_capture/)
    expect(source).toMatch(/decideReconcileLock/)
    expect(source).toMatch(/runHistoricalMemoryBuildPipeline/)
  })

  it('P0 (2026-09-18) — bloque une reprise si les propositions acceptées ne sont pas matérialisées', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    expect(source).toMatch(/getProposalMaterializationReport\(runId\)/)
    expect(source).toMatch(/materializationReport\.materialized < acceptedNotRejected/)
    expect(source).toMatch(/Matérialisation historique incomplète/)
    expect(source).toMatch(/return 'failed'/)

    const deletedSourceGate = source.indexOf('isSourceDocumentDeleted(sb, typedStatus?.source_document_id)')
    const materializationCheck = source.indexOf('getProposalMaterializationReport(runId)')
    const lockDecision = source.indexOf('decideReconcileLock(typedStatus, Date.now())')
    const memoryPipeline = source.indexOf('runHistoricalMemoryBuildPipeline({')
    const liveWriter = source.indexOf('runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })')

    expect(deletedSourceGate).toBeGreaterThan(-1)
    expect(materializationCheck).toBeGreaterThan(deletedSourceGate)
    expect(lockDecision).toBeGreaterThan(materializationCheck)
    expect(memoryPipeline).toBeGreaterThan(materializationCheck)
    expect(liveWriter).toBeGreaterThan(materializationCheck)
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

  it('P0 (2026-09-17) — un document source supprimé court-circuite avant tout verrou/écriture', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    expect(source).toMatch(/isSourceDocumentDeleted\(sb, typedStatus\?\.source_document_id\)/)
    expect(source).toMatch(/return 'source_deleted'/)

    const gate = source.indexOf('isSourceDocumentDeleted(sb, typedStatus?.source_document_id)')
    const lockDecision = source.indexOf('decideReconcileLock(typedStatus, Date.now())')
    const acquireLock = source.indexOf('acquireReconcileLock(sb, siteReportId')
    expect(gate).toBeGreaterThan(-1)
    // La porte P0 précède la décision de verrou ET toute acquisition — jamais de
    // lecture/écriture de verrou sur un rapport dont le document source est supprimé.
    expect(lockDecision).toBeGreaterThan(gate)
    expect(acquireLock).toBeGreaterThan(gate)
  })

  it('P0 (2026-09-21) — une erreur canonique résiduelle invalide un décision "done" stale', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    // decideReconcileLock ne connaît pas canonical_reconcile_error sur cette voie
    // (pas de hash de contenu) : le point d'appel doit forcer une reprise si une
    // erreur traîne, sinon elle ne s'efface jamais après correction de sa cause.
    expect(source).toMatch(
      /if \(decision === 'done' && typedStatus\?\.canonical_reconcile_error\) \{\s*decision = 'acquire'\s*\}/,
    )

    const decisionCall = source.indexOf('decideReconcileLock(typedStatus, Date.now())')
    const overrideCheck = source.indexOf("decision === 'done' && typedStatus?.canonical_reconcile_error")
    const concurrentCheck = source.indexOf("if (decision === 'concurrent') return 'concurrent'")
    const alreadyCompletedCheck = source.indexOf("return 'already_completed'")

    expect(decisionCall).toBeGreaterThan(-1)
    // L'override doit intervenir entre le calcul de la décision et tout usage de
    // celle-ci (concurrent / already_completed / acquire) — sinon une erreur
    // résiduelle continuerait de produire un faux 'already_completed'.
    expect(overrideCheck).toBeGreaterThan(decisionCall)
    expect(concurrentCheck).toBeGreaterThan(overrideCheck)
    expect(alreadyCompletedCheck).toBeGreaterThan(overrideCheck)
  })

  it('câble le P6 Live Writer historical_pdf en best-effort, après attach et avant le pont documentaire', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    expect(source).toMatch(/runTrackedPointLiveWriterForHistoricalRun\(\{ runId, siteId \}\)/)

    const attach = source.indexOf('attachHistoricalReportEntitiesToCanonicalBusinessObjects({ siteId')
    const liveWriter = source.indexOf('runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })')
    const resolve = source.indexOf('resolveSiteDocumentCompletionsByProposal(siteId)')
    expect(attach).toBeGreaterThan(-1)
    expect(liveWriter).toBeGreaterThan(attach)
    expect(resolve).toBeGreaterThan(liveWriter)

    // Best-effort : l'appel est enveloppé dans un try/catch dédié, jamais laissé remonter.
    const tryStart = source.lastIndexOf('try {', liveWriter)
    const catchStart = source.indexOf('} catch (err) {', liveWriter)
    expect(tryStart).toBeGreaterThan(attach)
    expect(catchStart).toBeGreaterThan(liveWriter)
    expect(source.slice(catchStart, catchStart + 400)).toMatch(/console\.error/)
  })
})
