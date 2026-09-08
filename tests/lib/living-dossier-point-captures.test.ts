// POINT VERIFY MIGRATION (mandat Vincent, points A+B). getLivingDossier doit
// montrer les captures rattachées à un Point suivi (tracked_point_id, jamais
// subject_id) quand ce Point est lié au sujet legacy via canonical_subject_id —
// y compris quand la capture est physiquement attachée à un Point A ensuite
// fusionné dans B (mandat B : jamais de réécriture d'historique, la capture
// reste sur A, mais doit rester visible en lisant B, exactement une fois).
//
// Seuls resolveTrackedPointIdsForSubject, listVisitCapturesByTrackedPointIds et
// listVisitCapturesBySubject tournent en RÉEL contre un faux client Supabase —
// pas de mock de la logique elle-même, pour prouver le vrai comportement de
// composition de fusion (buildPointMergeComponents), pas une façade.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type TrackedPointTestRow = {
  id: string
  site_id: string
  status: 'active' | 'merged' | 'retired'
  merged_into_id: string | null
  canonical_subject_id: string | null
}
type CaptureTestRow = {
  id: string
  subject_id: string | null
  tracked_point_id: string | null
  status: string
  kind: string
  created_at: string
}

const trackedPointTable = vi.fn<() => TrackedPointTestRow[]>(() => [])
const visitCaptureTable = vi.fn<() => CaptureTestRow[]>(() => [])

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'tracked_point') {
        return {
          select: () => ({
            eq: async (col: string, val: string) => ({
              data: trackedPointTable().filter((r) => (r as never as Record<string, unknown>)[col] === val),
              error: null,
            }),
          }),
        }
      }
      if (table === 'visit_capture') {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              neq: () => ({
                order: async () => ({
                  data: visitCaptureTable().filter((r) => (r as never as Record<string, unknown>)[col] === val && r.status !== 'discarded'),
                  error: null,
                }),
              }),
            }),
            in: (col: string, vals: string[]) => ({
              neq: () => ({
                order: async () => ({
                  data: visitCaptureTable().filter((r) => vals.includes((r as never as Record<string, unknown>)[col] as string) && r.status !== 'discarded'),
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  })),
}))

vi.mock('@/lib/db/site-cockpit', () => ({ getSiteIdentity: vi.fn(async () => ({ id: 'site', name: 'Chantier test' })) }))
vi.mock('@/lib/db/subject-relations', () => ({ getSubjectRelations: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/captured-knowledge', () => ({ listCapturedKnowledgeBySubject: vi.fn(async () => []) }))

const SITE_ID = 'ab8a5a2e-9c1a-4c2b-8f3a-8b6a1a2b3c4d'
const SUBJECT_ID = '933cdb50-a5bc-43b6-a56c-e788a4bce6b4'
const POINT_A_ID = '9cef4fed-1802-477c-803e-476a39caaf45'
const POINT_B_ID = '1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d'

vi.mock('@/lib/db/subjects', () => ({
  getSubjectThread: vi.fn(async (subjectId: string) => ({
    subject: { id: subjectId, site_id: SITE_ID, status: 'open' },
    actions: [], reserves: [], decisions: [], siteDecisions: [], siteDeadlines: [], anomalies: [], documents: [],
  })),
  getSubjectTimeline: vi.fn(async () => []),
  getSubjectInsights: vi.fn(async () => ({ state: 'ouvert', cause: null })),
}))

import { getLivingDossier } from '@/lib/db/living-dossier'

beforeEach(() => {
  vi.clearAllMocks()
  trackedPointTable.mockReturnValue([])
  visitCaptureTable.mockReturnValue([])
})

describe('getLivingDossier — captures liées à un Point suivi (mig 397, mandat A+B)', () => {
  it('sujet purement legacy (aucun Point lié) : comportement inchangé, seules les captures subject_id comptent', async () => {
    visitCaptureTable.mockReturnValue([
      { id: 'cap-1', subject_id: SUBJECT_ID, tracked_point_id: null, status: 'active', kind: 'verification', created_at: '2026-09-01' },
    ])

    const dossier = await getLivingDossier(SITE_ID, SUBJECT_ID)

    expect(dossier?.detail.visitCaptures.map((c) => c.id)).toEqual(['cap-1'])
    expect(dossier?.evidence.captures).toBe(1)
  })

  it('mandat A : Point non fusionné qui possède le sujet (canonical_subject_id) → sa capture devient visible', async () => {
    trackedPointTable.mockReturnValue([
      { id: POINT_B_ID, site_id: SITE_ID, status: 'active', merged_into_id: null, canonical_subject_id: SUBJECT_ID },
    ])
    visitCaptureTable.mockReturnValue([
      { id: 'cap-point', subject_id: null, tracked_point_id: POINT_B_ID, status: 'active', kind: 'verification', created_at: '2026-09-05' },
    ])

    const dossier = await getLivingDossier(SITE_ID, SUBJECT_ID)

    expect(dossier?.detail.visitCaptures.map((c) => c.id)).toEqual(['cap-point'])
    expect(dossier?.evidence.captures).toBe(1)
    expect(dossier?.evidence.verifications).toBe(1)
  })

  it('mandat B : capture physiquement attachée à A, A fusionné dans B qui possède le sujet → visible en lisant B, exactement une fois', async () => {
    trackedPointTable.mockReturnValue([
      { id: POINT_B_ID, site_id: SITE_ID, status: 'active', merged_into_id: null, canonical_subject_id: SUBJECT_ID },
      { id: POINT_A_ID, site_id: SITE_ID, status: 'merged', merged_into_id: POINT_B_ID, canonical_subject_id: null },
    ])
    visitCaptureTable.mockReturnValue([
      { id: 'cap-on-a', subject_id: null, tracked_point_id: POINT_A_ID, status: 'active', kind: 'verification', created_at: '2026-08-20' },
    ])

    const dossier = await getLivingDossier(SITE_ID, SUBJECT_ID)

    // La capture reste physiquement attachée à A (jamais réécrite) mais reste
    // retrouvable en lisant le dossier du sujet possédé par B.
    expect(dossier?.detail.visitCaptures).toHaveLength(1)
    expect(dossier?.detail.visitCaptures[0].id).toBe('cap-on-a')
    expect(dossier?.detail.visitCaptures[0].tracked_point_id).toBe(POINT_A_ID)
    expect(dossier?.evidence.captures).toBe(1)
  })

  it('union sans collision : capture subject_id-legacy + capture Point fusionné coexistent, comptées séparément', async () => {
    trackedPointTable.mockReturnValue([
      { id: POINT_B_ID, site_id: SITE_ID, status: 'active', merged_into_id: null, canonical_subject_id: SUBJECT_ID },
      { id: POINT_A_ID, site_id: SITE_ID, status: 'merged', merged_into_id: POINT_B_ID, canonical_subject_id: null },
    ])
    visitCaptureTable.mockReturnValue([
      { id: 'cap-legacy', subject_id: SUBJECT_ID, tracked_point_id: null, status: 'active', kind: 'photo', created_at: '2026-07-01' },
      { id: 'cap-on-a', subject_id: null, tracked_point_id: POINT_A_ID, status: 'active', kind: 'verification', created_at: '2026-08-20' },
    ])

    const dossier = await getLivingDossier(SITE_ID, SUBJECT_ID)

    expect(dossier?.evidence.captures).toBe(2)
    expect(dossier?.detail.visitCaptures.map((c) => c.id).sort()).toEqual(['cap-legacy', 'cap-on-a'])
  })
})
