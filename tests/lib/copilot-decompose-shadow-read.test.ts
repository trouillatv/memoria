// @vitest-environment node
/**
 * P6-A2 — audit du shadow mode decompose-v2 (mig 339).
 * Vérifie l'agrégation demandée par Vincent : tours observés, buckets
 * 1-segment/ambiguous, 2+ segments, erreurs, latence, stabilité sur phrase
 * répétée.
 */
import { describe, it, expect, vi } from 'vitest'

type Row = {
  id: string
  created_at: string
  question: string
  segment_count: number
  ambiguous: boolean
  used_fallback: boolean
  segments: unknown[]
  latency_ms: number | null
  error: string | null
}

let rows: Row[] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        gte: () => ({
          order: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  }),
}))

import { getDecomposeShadowAudit } from '@/lib/db/copilot-decompose-shadow-read'

function row(overrides: Partial<Row>): Row {
  return {
    id: 'id-' + Math.random(),
    created_at: '2026-08-17T10:00:00Z',
    question: 'Question test',
    segment_count: 1,
    ambiguous: true,
    used_fallback: true,
    segments: [],
    latency_ms: 100,
    error: null,
    ...overrides,
  }
}

describe('getDecomposeShadowAudit — aucune donnée', () => {
  it('retourne un audit vide sans lever', async () => {
    rows = []
    const audit = await getDecomposeShadowAudit()
    expect(audit.turnsObserved).toBe(0)
    expect(audit.multiSegmentCases).toEqual([])
    expect(audit.stability).toEqual([])
  })
})

describe('getDecomposeShadowAudit — répartition par buckets', () => {
  it('compte correctement 1-seg ambiguous / 1-seg décidé / 2+ segments / erreurs', async () => {
    rows = [
      row({ id: 'a', segment_count: 1, ambiguous: true }),
      row({ id: 'b', segment_count: 1, ambiguous: false }),
      row({ id: 'c', segment_count: 3, ambiguous: false, question: 'Le portail est cassé. Planifie une réunion.' }),
      row({ id: 'd', segment_count: 0, ambiguous: true, error: 'provider down', latency_ms: null }),
    ]

    const audit = await getDecomposeShadowAudit()

    expect(audit.turnsObserved).toBe(4)
    expect(audit.oneSegmentAmbiguous).toBe(1)
    expect(audit.oneSegmentNotAmbiguous).toBe(1)
    expect(audit.multiSegment).toBe(1)
    expect(audit.multiSegmentCases).toHaveLength(1)
    expect(audit.multiSegmentCases[0].question).toBe('Le portail est cassé. Planifie une réunion.')
    expect(audit.errorCount).toBe(1)
    expect(audit.errorSamples[0].error).toBe('provider down')
  })

  it('calcule médiane / p95 / max de latence en ignorant les valeurs nulles', async () => {
    rows = [
      row({ id: 'a', latency_ms: 100 }),
      row({ id: 'b', latency_ms: 200 }),
      row({ id: 'c', latency_ms: 300 }),
      row({ id: 'd', latency_ms: null }),
    ]

    const audit = await getDecomposeShadowAudit()

    expect(audit.latency.medianMs).toBe(200)
    expect(audit.latency.maxMs).toBe(300)
  })
})

describe('getDecomposeShadowAudit — stabilité sur phrase répétée', () => {
  it('phrase identique répétée avec le même découpage → stable', async () => {
    rows = [
      row({ id: 'a', question: 'Où en est le SSI ?', segment_count: 1, ambiguous: true }),
      row({ id: 'b', question: 'Où en est le SSI ?', segment_count: 1, ambiguous: true }),
    ]

    const audit = await getDecomposeShadowAudit()

    expect(audit.stability).toHaveLength(1)
    expect(audit.stability[0].occurrences).toBe(2)
    expect(audit.stability[0].stable).toBe(true)
  })

  it('phrase identique répétée avec un découpage différent → instable', async () => {
    rows = [
      row({ id: 'a', question: 'Où en est le SSI ?', segment_count: 1, ambiguous: true }),
      row({ id: 'b', question: 'Où en est le SSI ?', segment_count: 2, ambiguous: false }),
    ]

    const audit = await getDecomposeShadowAudit()

    expect(audit.stability).toHaveLength(1)
    expect(audit.stability[0].stable).toBe(false)
  })

  it('phrase vue une seule fois : absente du rapport de stabilité', async () => {
    rows = [row({ id: 'a', question: 'Phrase unique' })]

    const audit = await getDecomposeShadowAudit()

    expect(audit.stability).toEqual([])
  })
})
