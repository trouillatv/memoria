// POINT VERIFY MIGRATION (mandat Vincent, point 5 — lecture aval, consumer
// listVisitTouchedDossiers). Une capture 'verification' liée à un tracked_point
// (jamais un subject_id legacy) doit apparaître dans les dossiers "touchés" par
// la visite au même titre qu'un sujet, sans inventer cause/openActions/
// openReserves/openQuestion (escalade disclosed : aucun moteur d'insights Point
// équivalent à computeSubjectInsights dans ce lot).

import { describe, it, expect, vi, beforeEach } from 'vitest'

type VisitCaptureTouchRow = { subject_id: string | null; tracked_point_id: string | null; site_id: string }

const visitCaptureRows = vi.fn<() => VisitCaptureTouchRow[]>(() => [])
const subjectRows = vi.fn<() => Array<{ id: string; name: string }>>(() => [])

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'visit_capture') {
        return {
          select: () => ({
            eq: () => ({
              neq: async () => ({ data: visitCaptureRows() }),
            }),
          }),
        }
      }
      if (table === 'subjects') {
        return { select: () => ({ in: async () => ({ data: subjectRows() }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  })),
}))

const getSubjectInsights = vi.fn(async (id: string) => ({
  state: 'ouvert', cause: { text: `cause de ${id}` }, openActions: 1, openReserves: 0, openQuestion: null,
}))

vi.mock('@/lib/db/subjects', () => ({
  getSubjectThread: vi.fn(),
  getSubjectTimeline: vi.fn(),
  getSubjectInsights: (id: string) => getSubjectInsights(id),
}))
vi.mock('@/lib/db/site-cockpit', () => ({ getSiteIdentity: vi.fn() }))
vi.mock('@/lib/db/subject-relations', () => ({ getSubjectRelations: vi.fn() }))
vi.mock('@/lib/db/captured-knowledge', () => ({ listCapturedKnowledgeBySubject: vi.fn() }))
vi.mock('@/lib/db/visit-captures', () => ({ listVisitCapturesBySubject: vi.fn() }))

type PointReadModelStub = { points: Array<{ id: string; label: string; derivedState: string }>; mergedPoints: never[]; bySubject: Map<string, never>; pendingIdentityCandidates: never[] }

const loadTrackedPointReadModel = vi.fn<(siteId: string) => Promise<PointReadModelStub>>(async (siteId) => {
  void siteId
  return { points: [], mergedPoints: [], bySubject: new Map<string, never>(), pendingIdentityCandidates: [] }
})
vi.mock('@/lib/knowledge/tracked-point-read-model', () => ({
  loadTrackedPointReadModel: (siteId: string) => loadTrackedPointReadModel(siteId),
}))

import { listVisitTouchedDossiers } from '@/lib/db/living-dossier'

const SITE_ID = '44460e17-d283-4150-b30e-2008035e0a3c'
const REPORT_ID = '41c582a6-261b-48ac-91fb-4c88eb471bdd'
const SUBJECT_ID = '933cdb50-a5bc-43b6-a56c-e788a4bce6b4'
const POINT_ID = '9cef4fed-1802-477c-803e-476a39caaf45'

beforeEach(() => {
  vi.clearAllMocks()
  visitCaptureRows.mockReturnValue([])
  subjectRows.mockReturnValue([])
  getSubjectInsights.mockResolvedValue({ state: 'ouvert', cause: { text: 'cause' }, openActions: 1, openReserves: 0, openQuestion: null } as never)
  loadTrackedPointReadModel.mockResolvedValue({ points: [], mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [] } as never)
})

describe('listVisitTouchedDossiers — captures liées à un tracked_point (mig 397)', () => {
  it('une capture verification tracked_point_id-only produit un dossier touché', async () => {
    visitCaptureRows.mockReturnValue([{ subject_id: null, tracked_point_id: POINT_ID, site_id: SITE_ID }])
    loadTrackedPointReadModel.mockResolvedValue({
      points: [{ id: POINT_ID, label: 'Extincteur hall A', derivedState: 'open' }],
      mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [],
    } as never)

    const result = await listVisitTouchedDossiers(REPORT_ID)

    expect(result).toEqual([{
      id: POINT_ID,
      name: 'Extincteur hall A',
      state: 'open',
      cause: null,
      openActions: 0,
      openReserves: 0,
      openQuestion: null,
    }])
  })

  it('mixte sujet legacy + tracked_point : les deux apparaissent, sujet en premier', async () => {
    visitCaptureRows.mockReturnValue([
      { subject_id: SUBJECT_ID, tracked_point_id: null, site_id: SITE_ID },
      { subject_id: null, tracked_point_id: POINT_ID, site_id: SITE_ID },
    ])
    subjectRows.mockReturnValue([{ id: SUBJECT_ID, name: 'Sujet legacy' }])
    loadTrackedPointReadModel.mockResolvedValue({
      points: [{ id: POINT_ID, label: 'Point suivi', derivedState: 'reopened' }],
      mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [],
    } as never)

    const result = await listVisitTouchedDossiers(REPORT_ID)

    expect(result.map((d) => d.id)).toEqual([SUBJECT_ID, POINT_ID])
    expect(result[1]).toEqual({
      id: POINT_ID, name: 'Point suivi', state: 'reopened',
      cause: null, openActions: 0, openReserves: 0, openQuestion: null,
    })
  })

  it('tracked_point_id référencé mais absent du read-model (orphelin/supprimé) → ignoré, jamais planté', async () => {
    visitCaptureRows.mockReturnValue([{ subject_id: null, tracked_point_id: POINT_ID, site_id: SITE_ID }])
    loadTrackedPointReadModel.mockResolvedValue({ points: [], mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [] } as never)

    const result = await listVisitTouchedDossiers(REPORT_ID)
    expect(result).toEqual([])
  })

  it('aucune capture → liste vide', async () => {
    visitCaptureRows.mockReturnValue([])
    const result = await listVisitTouchedDossiers(REPORT_ID)
    expect(result).toEqual([])
  })
})
