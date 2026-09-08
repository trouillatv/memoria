// POINT VERIFY MIGRATION (mandat Vincent, points 3 et 4 — invariant de site + garde XOR).
// drainLightCaptureAction (app/(field)/m/site/[siteId]/capture-actions.ts) : le geste
// 'verification' doit accepter subject_id XOR tracked_point_id (jamais aucun, jamais les
// deux), et un tracked_point d'un AUTRE chantier doit échouer fermé (fail closed), sans
// jamais chercher par nom ni faire confiance au client.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/field/auth', () => ({
  requireFieldAgent: vi.fn(async () => ({ userId: 'user-1', role: 'chef_equipe' })),
}))

const trackedPointRow = vi.fn<() => { data: { id: string; site_id: string } | null; error: unknown }>(
  () => ({ data: null, error: null }),
)

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== 'tracked_point') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => trackedPointRow(),
          }),
        }),
      }
    },
  })),
}))

vi.mock('@/lib/ai/transcribe', () => ({ mimeToExt: vi.fn(), transcribeAudio: vi.fn() }))
vi.mock('@/lib/ai/normalize-caption', () => ({ normalizeCaptionWithLLM: vi.fn() }))
vi.mock('@/lib/db/captured-knowledge', () => ({ addCapturedKnowledge: vi.fn() }))
vi.mock('@/app/(field)/m/site/[siteId]/report-actions', () => ({ uploadReportAttachmentAction: vi.fn() }))

const getSiteReport = vi.fn(async () => ({ id: 'report-1', tenant_id: 'tenant-1' }))
const findVisitCaptureIdByClientUuid = vi.fn(async () => null as string | null)
const addVisitCapture = vi.fn(async () => 'capture-1')

vi.mock('@/lib/db/site-reports', () => ({
  getSiteReport: (...args: Parameters<typeof getSiteReport>) => getSiteReport(...args),
  addReportAttachment: vi.fn(),
}))

vi.mock('@/lib/db/visit-captures', () => ({
  addVisitCapture: (...args: Parameters<typeof addVisitCapture>) => addVisitCapture(...args),
  findVisitCaptureIdByClientUuid: (...args: Parameters<typeof findVisitCaptureIdByClientUuid>) => findVisitCaptureIdByClientUuid(...args),
  listVisitCaptures: vi.fn(),
  getVisitCapturePreviewUrls: vi.fn(),
  removeCaptureWhileCollecting: vi.fn(),
  setCaptureStarred: vi.fn(),
  setCaptureViewpoint: vi.fn(),
  setCaptureLocationCorrection: vi.fn(),
  appendCaptureCaption: vi.fn(),
}))

import { drainLightCaptureAction } from '@/app/(field)/m/site/[siteId]/capture-actions'

const SITE_ID = '44460e17-d283-4150-b30e-2008035e0a3c'
const OTHER_SITE_ID = '9c833d08-9354-46aa-ad01-4104645a0eb9'
const REPORT_ID = '41c582a6-261b-48ac-91fb-4c88eb471bdd'
const SUBJECT_ID = '933cdb50-a5bc-43b6-a56c-e788a4bce6b4'
const POINT_ID = '9cef4fed-1802-477c-803e-476a39caaf45'
const CLIENT_UUID = '6a84aad9-f84b-4154-a264-4786d6213393'

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    report_id: REPORT_ID,
    site_id: SITE_ID,
    client_uuid: CLIENT_UUID,
    kind: 'verification' as const,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getSiteReport.mockResolvedValue({ id: REPORT_ID, tenant_id: 'tenant-1' } as never)
  findVisitCaptureIdByClientUuid.mockResolvedValue(null)
  addVisitCapture.mockResolvedValue('capture-1')
  trackedPointRow.mockReturnValue({ data: null, error: null })
})

describe('drainLightCaptureAction — garde XOR subject_id / tracked_point_id (verification)', () => {
  it('ni subject_id ni tracked_point_id → condamné (FAIL, drop)', async () => {
    const result = await drainLightCaptureAction(baseInput())
    expect(result).toEqual({ ok: false, error: 'Point suivi manquant', drop: true })
    expect(addVisitCapture).not.toHaveBeenCalled()
  })

  it('subject_id ET tracked_point_id → condamné, cible ambiguë (FAIL, drop)', async () => {
    const result = await drainLightCaptureAction(baseInput({ subject_id: SUBJECT_ID, tracked_point_id: POINT_ID }))
    expect(result).toEqual({ ok: false, error: 'Cible de vérification ambiguë', drop: true })
    expect(addVisitCapture).not.toHaveBeenCalled()
  })

  it('subject_id seul → accepté (PASS), écrit subjectId sans trackedPointId', async () => {
    const result = await drainLightCaptureAction(baseInput({ subject_id: SUBJECT_ID }))
    expect(result).toEqual({ ok: true, captureId: 'capture-1', kind: 'verification' })
    expect(addVisitCapture).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: SUBJECT_ID, trackedPointId: null }),
    )
  })

  it('tracked_point_id seul, même chantier → accepté (PASS), écrit trackedPointId sans subjectId', async () => {
    trackedPointRow.mockReturnValue({ data: { id: POINT_ID, site_id: SITE_ID }, error: null })
    const result = await drainLightCaptureAction(baseInput({ tracked_point_id: POINT_ID }))
    expect(result).toEqual({ ok: true, captureId: 'capture-1', kind: 'verification' })
    expect(addVisitCapture).toHaveBeenCalledWith(
      expect.objectContaining({ trackedPointId: POINT_ID, subjectId: null }),
    )
  })
})

describe('drainLightCaptureAction — invariant de site (mandat point 3, fail closed)', () => {
  it('tracked_point appartenant à un AUTRE chantier → condamné, jamais écrit', async () => {
    trackedPointRow.mockReturnValue({ data: { id: POINT_ID, site_id: OTHER_SITE_ID }, error: null })
    const result = await drainLightCaptureAction(baseInput({ site_id: SITE_ID, tracked_point_id: POINT_ID }))
    expect(result).toEqual({ ok: false, error: 'Point suivi hors chantier', drop: true })
    expect(addVisitCapture).not.toHaveBeenCalled()
  })

  it('tracked_point introuvable → condamné, jamais écrit', async () => {
    trackedPointRow.mockReturnValue({ data: null, error: null })
    const result = await drainLightCaptureAction(baseInput({ tracked_point_id: POINT_ID }))
    expect(result).toEqual({ ok: false, error: 'Point suivi hors chantier', drop: true })
    expect(addVisitCapture).not.toHaveBeenCalled()
  })

  it('erreur de lecture tracked_point → échec transitoire (pas drop, retry possible)', async () => {
    trackedPointRow.mockReturnValue({ data: null, error: new Error('boom') })
    const result = await drainLightCaptureAction(baseInput({ tracked_point_id: POINT_ID }))
    expect(result).toEqual({ ok: false, error: 'Échec de la capture' })
    expect(addVisitCapture).not.toHaveBeenCalled()
  })
})
