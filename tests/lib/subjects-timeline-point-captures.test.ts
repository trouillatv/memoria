// POINT VERIFY MIGRATION (mandat Vincent, points A+B) — même invariant que
// tests/lib/living-dossier-point-captures.test.ts, mais sur getSubjectTimeline
// (lib/db/subjects.ts), le SECOND lecteur aval qui dupliquait indépendamment la
// même logique de captures. Toutes les tables non liées aux captures/Points
// renvoient un tableau vide (matière hors périmètre de ce test) ; seules
// resolveTrackedPointIdsForSubject et listVisitCapturesByTrackedPointIds
// tournent en RÉEL contre le faux client Supabase.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type TrackedPointTestRow = {
  id: string
  site_id: string
  status: 'active' | 'merged' | 'retired'
  merged_into_id: string | null
  canonical_subject_id: string | null
}
type CaptureTestRow = { id: string; subject_id: string | null; tracked_point_id: string | null; status: string; kind: string; body: string | null; created_at: string }

const trackedPointTable = vi.fn<() => TrackedPointTestRow[]>(() => [])
const visitCaptureTable = vi.fn<() => CaptureTestRow[]>(() => [])

function makeTableChain(rows: Array<Record<string, unknown>>) {
  let filtered = rows
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => { filtered = filtered.filter((r) => r[col] === val); return chain },
    in: (col: string, vals: unknown[]) => { filtered = filtered.filter((r) => vals.includes(r[col])); return chain },
    neq: (col: string, val: unknown) => { filtered = filtered.filter((r) => r[col] !== val); return chain },
    order: () => chain,
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: filtered, error: null }),
  }
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'tracked_point') return makeTableChain(trackedPointTable() as never)
      if (table === 'visit_capture') return makeTableChain(visitCaptureTable() as never)
      return makeTableChain([])
    },
  })),
}))
vi.mock('@/lib/db/documents', () => ({ listDocumentsForTarget: vi.fn(async () => []) }))

const SITE_ID = 'ab8a5a2e-9c1a-4c2b-8f3a-8b6a1a2b3c4d'
const SUBJECT_ID = '933cdb50-a5bc-43b6-a56c-e788a4bce6b4'
const POINT_A_ID = '9cef4fed-1802-477c-803e-476a39caaf45'
const POINT_B_ID = '1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d'

import { getSubjectTimeline } from '@/lib/db/subjects'

beforeEach(() => {
  vi.clearAllMocks()
  trackedPointTable.mockReturnValue([])
  visitCaptureTable.mockReturnValue([])
})

describe('getSubjectTimeline — captures liées à un Point suivi (mig 397, mandat A+B)', () => {
  it('mandat A : Point non fusionné qui possède le sujet → capture Point visible dans la timeline', async () => {
    trackedPointTable.mockReturnValue([
      { id: POINT_B_ID, site_id: SITE_ID, status: 'active', merged_into_id: null, canonical_subject_id: SUBJECT_ID },
    ])
    visitCaptureTable.mockReturnValue([
      { id: 'cap-point', subject_id: null, tracked_point_id: POINT_B_ID, status: 'active', kind: 'verification', body: 'RAS', created_at: '2026-09-05' },
    ])

    const events = await getSubjectTimeline(SUBJECT_ID, SITE_ID)
    const captureEvents = events.filter((e) => e.kind === 'capture')

    expect(captureEvents).toHaveLength(1)
    expect(captureEvents[0].label).toBe('Vérification : RAS')
  })

  it('mandat B : capture attachée à A, A fusionné dans B qui possède le sujet → visible exactement une fois en lisant B', async () => {
    trackedPointTable.mockReturnValue([
      { id: POINT_B_ID, site_id: SITE_ID, status: 'active', merged_into_id: null, canonical_subject_id: SUBJECT_ID },
      { id: POINT_A_ID, site_id: SITE_ID, status: 'merged', merged_into_id: POINT_B_ID, canonical_subject_id: null },
    ])
    visitCaptureTable.mockReturnValue([
      { id: 'cap-on-a', subject_id: null, tracked_point_id: POINT_A_ID, status: 'active', kind: 'photo', body: null, created_at: '2026-08-20' },
    ])

    const events = await getSubjectTimeline(SUBJECT_ID, SITE_ID)
    const captureEvents = events.filter((e) => e.kind === 'capture')

    expect(captureEvents).toHaveLength(1)
    expect(captureEvents[0].label).toBe('Photo')
  })

  it('aucun Point lié (sujet purement legacy) : aucun crash, aucune capture fantôme', async () => {
    const events = await getSubjectTimeline(SUBJECT_ID, SITE_ID)
    expect(events.filter((e) => e.kind === 'capture')).toHaveLength(0)
  })
})
