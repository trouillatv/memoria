import { describe, expect, it } from 'vitest'
import { deriveHistoricalMemoryUpdateStatus, type HistoricalMemoryUpdateReportRow } from '@/lib/subjects/historical-memory-update-status'

const doneReport = (overrides: HistoricalMemoryUpdateReportRow = {}): HistoricalMemoryUpdateReportRow => ({
  canonical_reconciled_at: '2026-09-20T00:00:00.000Z',
  similarity_analysis_completed_at: '2026-09-20T00:01:00.000Z',
  similarity_analysis_subject_count: 7,
  action_cbo_reconciled_at: '2026-09-20T00:02:00.000Z',
  tracked_point_live_writer_completed_at: '2026-09-20T00:03:00.000Z',
  document_completion_resolved_at: '2026-09-20T00:04:00.000Z',
  ...overrides,
})

describe('deriveHistoricalMemoryUpdateStatus', () => {
  it('ne déclare la mémoire à jour que lorsque toute la chaîne est terminée', () => {
    const status = deriveHistoricalMemoryUpdateStatus(doneReport(), {
      acceptedForMaterialization: 3,
      materialized: 3,
    })

    expect(status.state).toBe('up_to_date')
    expect(status.error).toBeNull()
    expect(status.subjectCount).toBe(7)
    expect(status.steps.map((step) => step.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
  })

  it('reste en cours si le Live Writer n’a pas encore produit de preuve durable', () => {
    const status = deriveHistoricalMemoryUpdateStatus(doneReport({
      tracked_point_live_writer_completed_at: null,
      document_completion_resolved_at: null,
    }), {
      acceptedForMaterialization: 1,
      materialized: 1,
    })

    expect(status.state).toBe('updating')
    expect(status.steps.map((step) => [step.key, step.status])).toContainEqual(['live_writer', 'current'])
    expect(status.steps.map((step) => [step.key, step.status])).toContainEqual(['completion', 'waiting'])
  })

  it('interrompt la chaîne si une proposition acceptée n’est pas matérialisée', () => {
    const status = deriveHistoricalMemoryUpdateStatus(doneReport(), {
      acceptedForMaterialization: 4,
      materialized: 2,
    })

    expect(status.state).toBe('interrupted')
    expect(status.error).toContain('2/4')
    expect(status.steps[0]).toMatchObject({ key: 'materialization', status: 'error' })
  })

  it('rend visible une erreur Live Writer au lieu de masquer la fin de chaîne', () => {
    const status = deriveHistoricalMemoryUpdateStatus(doneReport({
      tracked_point_live_writer_completed_at: null,
      tracked_point_live_writer_error: 'writer failed',
      document_completion_resolved_at: null,
    }), {
      acceptedForMaterialization: 1,
      materialized: 1,
    })

    expect(status.state).toBe('interrupted')
    expect(status.error).toBe('writer failed')
    expect(status.steps.map((step) => [step.key, step.status])).toContainEqual(['live_writer', 'error'])
  })
})
