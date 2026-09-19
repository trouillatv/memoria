import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('historical import post-processing orchestration', () => {
  it('schedules memory after the main historical visit materialization', () => {
    const source = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    const createAction = source.indexOf('export async function createHistoricalVisitAction')
    const materialize = source.indexOf('const result = await materializeHistoricalRun({', createAction)
    const schedule = source.indexOf('after(() => runHistoricalImportPostProcessing({', materialize)
    const success = source.indexOf('message: result.message', schedule)

    expect(createAction).toBeGreaterThan(-1)
    expect(materialize).toBeGreaterThan(-1)
    expect(schedule).toBeGreaterThan(materialize)
    expect(success).toBeGreaterThan(schedule)
    expect(source.slice(materialize, schedule)).not.toMatch(/reconcileHistoricalCorpusForSite\(/)
  })

  it('retry, sweep, and late review reuse the same post-processing orchestrator', () => {
    const actions = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    const sweep = read('lib/db/reconciliation-sweep.ts')
    // import + late accept/edit + creation + manual retry
    expect(actions.match(/runHistoricalImportPostProcessing/g)).toHaveLength(4)
    expect(sweep).toMatch(/runHistoricalImportPostProcessing/)
  })

  it('the orchestrator never calls the main materialization RPC', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    expect(source).not.toMatch(/\bmaterializeHistoricalVisit\(/)
    expect(source).not.toMatch(/visit_capture/)
    expect(source).toMatch(/decideReconcileLock/)
    expect(source).toMatch(/runHistoricalMemoryBuildPipeline/)
  })

  it('blocks post-processing when accepted proposals are not materialized', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    expect(source).toMatch(/getProposalMaterializationReport\(runId\)/)
    expect(source).toMatch(/materializationReport\.materialized < acceptedNotRejected/)
    expect(source).toMatch(/Mat.rialisation historique incompl.te/)
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

  it('wires the proposal-level document completion bridge, not the occurrence-level one', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    expect(source).toMatch(/resolveSiteDocumentCompletionsByProposal\(siteId\)/)
    expect(source).not.toMatch(/\bresolveSiteDocumentCompletions\(siteId\)/)

    const attach = source.indexOf('attachHistoricalReportEntitiesToCanonicalBusinessObjects({ siteId')
    const resolve = source.indexOf('resolveSiteDocumentCompletionsByProposal(siteId)')
    expect(attach).toBeGreaterThan(-1)
    expect(resolve).toBeGreaterThan(attach)
    expect(source).not.toMatch(/object_state_occurrence_signal/)
  })

  it('short-circuits a deleted source document before locks or writes', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    expect(source).toMatch(/isSourceDocumentDeleted\(sb, typedStatus\?\.source_document_id\)/)
    expect(source).toMatch(/return 'source_deleted'/)

    const gate = source.indexOf('isSourceDocumentDeleted(sb, typedStatus?.source_document_id)')
    const lockDecision = source.indexOf('decideReconcileLock(typedStatus, Date.now())')
    const acquireLock = source.indexOf('acquireReconcileLock(sb, siteReportId')
    expect(gate).toBeGreaterThan(-1)
    expect(lockDecision).toBeGreaterThan(gate)
    expect(acquireLock).toBeGreaterThan(gate)
  })

  it('runs the historical_pdf Live Writer best-effort after CBO attach and before completions', () => {
    const source = read('lib/subjects/historical-import-post-processing.ts')
    expect(source).toMatch(/runTrackedPointLiveWriterForHistoricalRun\(\{ runId, siteId \}\)/)

    const attach = source.indexOf('attachHistoricalReportEntitiesToCanonicalBusinessObjects({ siteId')
    const liveWriter = source.indexOf('runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })')
    const resolve = source.indexOf('resolveSiteDocumentCompletionsByProposal(siteId)')
    expect(attach).toBeGreaterThan(-1)
    expect(liveWriter).toBeGreaterThan(attach)
    expect(resolve).toBeGreaterThan(liveWriter)

    const tryStart = source.lastIndexOf('try {', liveWriter)
    const catchStart = source.indexOf('} catch (err) {', liveWriter)
    expect(tryStart).toBeGreaterThan(attach)
    expect(catchStart).toBeGreaterThan(liveWriter)
    expect(source.slice(catchStart, catchStart + 400)).toMatch(/console\.error/)
  })
})
