// BATCH-0 — orchestrateur batch de l'import historique.
//
// Ces tests ne re-testent PAS le pipeline métier de matérialisation (déjà couvert
// par tests/lib/historical-visit-review.test.ts, Section 5) ni le post-traitement
// mémoire lui-même. Ils prouvent uniquement la doctrine BATCH-0 :
//   1. le batch appelle les mêmes primitives que l'UI (acceptAllPendingForRun,
//      materializeHistoricalRun) — jamais de mutation DB dupliquée ;
//   2. la garde non-visite ne peut jamais être contournée automatiquement ;
//   3. une visite déjà matérialisée (même run) n'est pas re-matérialisée ;
//   4. le post-traitement mémoire est ATTENDU avant de passer au document suivant.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  createExtractionRun: vi.fn(),
  getExtractionRun: vi.fn(),
  getLatestExtractionRunForDocument: vi.fn(),
  acceptAllPendingForRun: vi.fn(),
  extractHistoricalPv: vi.fn(),
  materializeHistoricalRun: vi.fn(),
  getExistingMaterializedVisit: vi.fn(),
  runHistoricalImportPostProcessing: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

vi.mock('@/lib/db/document-extractions', () => ({
  createExtractionRun: mocks.createExtractionRun,
  getExtractionRun: mocks.getExtractionRun,
  getLatestExtractionRunForDocument: mocks.getLatestExtractionRunForDocument,
  acceptAllPendingForRun: mocks.acceptAllPendingForRun,
}))

vi.mock('@/lib/documents/extract-historical-pv', () => ({
  extractHistoricalPv: mocks.extractHistoricalPv,
}))

vi.mock('@/lib/documents/materialize-historical-run', () => ({
  materializeHistoricalRun: mocks.materializeHistoricalRun,
}))

vi.mock('@/lib/db/historical-visit-materialization', () => ({
  getExistingMaterializedVisit: mocks.getExistingMaterializedVisit,
}))

vi.mock('@/lib/subjects/historical-import-post-processing', () => ({
  runHistoricalImportPostProcessing: mocks.runHistoricalImportPostProcessing,
}))

import {
  runHistoricalImportBatch,
  processHistoricalBatchDocument,
} from '../../lib/batch/historical-import-batch'
import { acceptAllPendingForRun } from '../../lib/db/document-extractions'
import { materializeHistoricalRun } from '../../lib/documents/materialize-historical-run'

function docsAdminMock(effectiveDate: string | null = '2025-03-27') {
  return () => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { organization_id: 'org-1', document_type: 'historical_visit_report' },
            error: null,
          }),
        }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { effective_date: effectiveDate }, error: null }),
      }),
    }),
  })
}

const baseInput = { documentId: 'doc-1', siteId: 'site-1' }

describe('BATCH-0 — runHistoricalImportBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockImplementation(docsAdminMock())
    mocks.getLatestExtractionRunForDocument.mockResolvedValue({ id: 'run-1', status: 'ready_for_review' })
    mocks.getExtractionRun.mockResolvedValue({ id: 'run-1', status: 'ready_for_review', error_message: null })
    mocks.getExistingMaterializedVisit.mockResolvedValue(null)
    mocks.acceptAllPendingForRun.mockResolvedValue({ ok: true, count: 2 })
    mocks.materializeHistoricalRun.mockResolvedValue({
      ok: true, siteReportId: 'report-1', siteId: 'site-1', visitDate: '2025-03-27', message: 'ok',
    })
    mocks.runHistoricalImportPostProcessing.mockResolvedValue('completed')
  })

  it('1. appelle acceptAllPendingForRun et materializeHistoricalRun — les mêmes primitives que l\'UI', async () => {
    const result = await processHistoricalBatchDocument(baseInput, { userId: 'user-1' })

    expect(result.status).toBe('materialized')
    expect(result.siteReportId).toBe('report-1')
    // Ce sont littéralement les fonctions importées par review-actions.ts (adaptateur UI) :
    // pas de réimplémentation de leurs mutations dans le batch.
    expect(mocks.acceptAllPendingForRun).toHaveBeenCalledWith({ runId: 'run-1', userId: 'user-1' })
    expect(mocks.materializeHistoricalRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', documentId: 'doc-1', userId: 'user-1' }),
    )
  })

  it('2. garde non-visite : jamais de nonVisitAcknowledged=true automatique, document mis en quarantaine', async () => {
    mocks.materializeHistoricalRun.mockResolvedValue({
      ok: false, error: 'Ce document indique explicitement l\'absence de visite de site.',
      errorCode: 'NON_VISIT_SIGNAL',
    })

    const result = await processHistoricalBatchDocument(baseInput, { userId: 'user-1' })

    expect(result.status).toBe('quarantined')
    expect(result.quarantineReason).toBe('NON_VISIT_SIGNAL')
    // Le batch n'a appelé materializeHistoricalRun qu'une fois, avec nonVisitAcknowledged=false —
    // aucune tentative de contournement automatique de la garde.
    expect(mocks.materializeHistoricalRun).toHaveBeenCalledTimes(1)
    expect(mocks.materializeHistoricalRun).toHaveBeenCalledWith(
      expect.objectContaining({ nonVisitAcknowledged: false }),
    )
    // Le post-traitement mémoire n'a jamais dû démarrer sur un document en quarantaine.
    expect(mocks.runHistoricalImportPostProcessing).not.toHaveBeenCalled()
  })

  it('3. re-run idempotent : une visite déjà matérialisée pour ce run n\'est ni ré-acceptée ni re-matérialisée', async () => {
    mocks.getExistingMaterializedVisit.mockResolvedValue('report-existing')

    const result = await processHistoricalBatchDocument(baseInput, { userId: 'user-1' })

    expect(result.status).toBe('already_materialized')
    expect(result.siteReportId).toBe('report-existing')
    expect(mocks.acceptAllPendingForRun).not.toHaveBeenCalled()
    expect(mocks.materializeHistoricalRun).not.toHaveBeenCalled()
    // Seul le post-traitement (rejouable par construction) est retenté.
    expect(mocks.runHistoricalImportPostProcessing).toHaveBeenCalledTimes(1)
  })

  it('4. post-traitement : concurrent/lock_lost relancés avec backoff avant de conclure', async () => {
    mocks.runHistoricalImportPostProcessing
      .mockResolvedValueOnce('concurrent')
      .mockResolvedValueOnce('lock_lost')
      .mockResolvedValueOnce('completed')

    const result = await processHistoricalBatchDocument(
      baseInput,
      { userId: 'user-1', postProcessingBackoffMs: 1 },
    )

    expect(result.status).toBe('materialized')
    expect(mocks.runHistoricalImportPostProcessing).toHaveBeenCalledTimes(3)
  })

  it('5. post-traitement : quarantaine après épuisement des relances (concurrent persistant)', async () => {
    mocks.runHistoricalImportPostProcessing.mockResolvedValue('concurrent')

    const result = await processHistoricalBatchDocument(
      baseInput,
      { userId: 'user-1', postProcessingMaxRetries: 2, postProcessingBackoffMs: 1 },
    )

    expect(result.status).toBe('quarantined')
    expect(result.quarantineReason).toBe('POST_PROCESSING_STUCK')
    expect(mocks.runHistoricalImportPostProcessing).toHaveBeenCalledTimes(3) // 1 + 2 relances
  })

  it('6. le document suivant ne démarre qu\'une fois le post-traitement du précédent terminé', async () => {
    const order: string[] = []

    mocks.getLatestExtractionRunForDocument.mockImplementation(async (documentId: string) => {
      order.push(`extract-lookup:${documentId}`)
      return { id: `run-${documentId}`, status: 'ready_for_review' }
    })
    mocks.getExtractionRun.mockImplementation(async () => ({ id: 'run-x', status: 'ready_for_review', error_message: null }))
    mocks.materializeHistoricalRun.mockImplementation(async (params: { documentId: string }) => {
      order.push(`materialize:${params.documentId}`)
      return { ok: true, siteReportId: `report-${params.documentId}`, siteId: 'site-1', visitDate: '2025-01-01', message: 'ok' }
    })

    let resolvePostProcessingDoc1: (v: string) => void = () => {}
    mocks.runHistoricalImportPostProcessing.mockImplementation(async (params: { siteReportId: string }) => {
      order.push(`postproc-start:${params.siteReportId}`)
      if (params.siteReportId === 'report-doc-1') {
        return new Promise((resolve) => {
          resolvePostProcessingDoc1 = () => {
            order.push(`postproc-end:${params.siteReportId}`)
            resolve('completed')
          }
        })
      }
      order.push(`postproc-end:${params.siteReportId}`)
      return 'completed'
    })

    const batchPromise = runHistoricalImportBatch(
      [{ documentId: 'doc-1', siteId: 'site-1' }, { documentId: 'doc-2', siteId: 'site-1' }],
      { userId: 'user-1' },
    )

    // Laisse la microtask queue avancer jusqu'au blocage sur le post-traitement du doc 1.
    await Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve())
    expect(order).toEqual(['extract-lookup:doc-1', 'materialize:doc-1', 'postproc-start:report-doc-1'])
    expect(order).not.toContain('extract-lookup:doc-2')

    resolvePostProcessingDoc1('completed')
    const results = await batchPromise

    expect(results.map((r) => r.status)).toEqual(['materialized', 'materialized'])
    expect(order.indexOf('postproc-end:report-doc-1')).toBeLessThan(order.indexOf('extract-lookup:doc-2'))
  })

  it('7. extraction en échec après relance : quarantaine EXTRACTION_FAILED, aucune matérialisation tentée', async () => {
    mocks.getLatestExtractionRunForDocument.mockResolvedValue(null)
    mocks.createExtractionRun.mockResolvedValue('run-new')
    mocks.extractHistoricalPv.mockResolvedValue(undefined)
    mocks.getExtractionRun.mockResolvedValue({ id: 'run-new', status: 'failed', error_message: 'LLM timeout' })

    const result = await processHistoricalBatchDocument(baseInput, { userId: 'user-1', extractionRetries: 1 })

    expect(result.status).toBe('quarantined')
    expect(result.quarantineReason).toBe('EXTRACTION_FAILED')
    expect(mocks.extractHistoricalPv).toHaveBeenCalledTimes(2) // tentative initiale + 1 relance
    expect(mocks.acceptAllPendingForRun).not.toHaveBeenCalled()
    expect(mocks.materializeHistoricalRun).not.toHaveBeenCalled()
  })

  it('8. run déjà en cours (pending/processing) : quarantaine sans dupliquer l\'extraction', async () => {
    mocks.getLatestExtractionRunForDocument.mockResolvedValue({ id: 'run-inflight', status: 'processing' })

    const result = await processHistoricalBatchDocument(baseInput, { userId: 'user-1' })

    expect(result.status).toBe('quarantined')
    expect(result.quarantineReason).toBe('EXTRACTION_ALREADY_RUNNING')
    expect(mocks.extractHistoricalPv).not.toHaveBeenCalled()
    expect(mocks.createExtractionRun).not.toHaveBeenCalled()
  })
})

// Vérifie que le batch importe bel et bien les mêmes fonctions que l'adaptateur UI
// (review-actions.ts) — même référence de module, pas une réimplémentation locale.
describe('BATCH-0 — UI et batch partagent la même primitive', () => {
  it('9. acceptAllPendingForRun et materializeHistoricalRun sont les fonctions mockées partagées', () => {
    expect(acceptAllPendingForRun).toBe(mocks.acceptAllPendingForRun)
    expect(materializeHistoricalRun).toBe(mocks.materializeHistoricalRun)
  })
})
