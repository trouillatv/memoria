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
})
