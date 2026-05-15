// Sprint 3 — UX-8 Mode litige express : tests prepareLitigeDossierAction.
//
// Stratégie : mocks pour auth, headers, helpers DB (searchProofs +
// createShareToken) et audit log. On vérifie la sémantique de validation +
// le pipeline de comptage + le fallback "période vide".
//
// Doctrine V5 — Pilier 1 + Verrou V1 + Verrou V4 :
//   - Wording strictement passif.
//   - Aucun score / pourcentage / classement.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ----------------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------------

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (key: string) => {
      if (key === 'x-forwarded-proto') return 'https'
      if (key === 'x-forwarded-host') return 'test.memoria.app'
      if (key === 'host') return 'test.memoria.app'
      return null
    },
  })),
}))

vi.mock('@/lib/db/users', () => ({
  getCurrentUserWithProfile: vi.fn(async () => ({
    id: '00000000-0000-4000-8000-000000000001',
    role: 'admin',
    email: 'admin@test',
    full_name: 'Admin Test',
  })),
}))

const searchProofsMock = vi.fn()
vi.mock('@/lib/db/proofs', () => ({
  searchProofs: (...args: unknown[]) => searchProofsMock(...args),
}))

const createShareTokenMock = vi.fn()
vi.mock('@/lib/db/proof-share', () => ({
  createShareToken: (...args: unknown[]) => createShareTokenMock(...args),
}))

interface AuditCall {
  userId: string | null
  entityType: string
  entityId: string | null
  action: string
  metadata?: Record<string, unknown>
}
const logAuditEventMock = vi.fn<(event: AuditCall) => Promise<void>>(
  async () => undefined,
)
vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: (event: AuditCall) => logAuditEventMock(event),
}))

// ----------------------------------------------------------------------------
// Import après les mocks (lazy import pour s'assurer que vi.mock est en place)
// ----------------------------------------------------------------------------

async function importAction() {
  return await import('@/app/(dashboard)/litige/actions')
}

const VALID_SITE_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  searchProofsMock.mockReset()
  createShareTokenMock.mockReset()
  logAuditEventMock.mockClear()
})

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('prepareLitigeDossierAction — validation', () => {
  it('sans siteId valide → ok=false avec error', async () => {
    const { prepareLitigeDossierAction } = await importAction()
    const res = await prepareLitigeDossierAction({
      siteId: 'not-a-uuid',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-13',
      includeInterventions: true,
      includePhotos: true,
      includeAnomalies: true,
      includeValidations: true,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    expect(searchProofsMock).not.toHaveBeenCalled()
  })

  it('dateFrom > dateTo → ok=false', async () => {
    const { prepareLitigeDossierAction } = await importAction()
    const res = await prepareLitigeDossierAction({
      siteId: VALID_SITE_ID,
      dateFrom: '2026-05-20',
      dateTo: '2026-05-10',
      includeInterventions: true,
      includePhotos: true,
      includeAnomalies: true,
      includeValidations: true,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/postérieure/i)
  })
})

describe('prepareLitigeDossierAction — happy path', () => {
  it('avec params valides + interventions → counts + URLs + token', async () => {
    searchProofsMock.mockResolvedValue({
      items: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          title: 'Intervention test 1',
          scheduled_for: '2026-05-10',
          scheduled_at: '2026-05-10T09:00:00.000Z',
          executed_at: '2026-05-10T11:00:00.000Z',
          status: 'completed',
          skipped_at: null,
          skipped_reason: null,
          mission_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          mission_name: 'Mission A',
          site_id: VALID_SITE_ID,
          site_name: 'Site Alpha',
          contract_id: null,
          contract_name: null,
          client_name: null,
          photosCount: 5,
          anomaliesCount: 2,
          anomaliesResolvedCount: 1,
          validationsCount: 1,
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          title: 'Intervention test 2',
          scheduled_for: '2026-05-11',
          scheduled_at: '2026-05-11T09:00:00.000Z',
          executed_at: null,
          status: 'planned',
          skipped_at: null,
          skipped_reason: null,
          mission_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          mission_name: 'Mission A',
          site_id: VALID_SITE_ID,
          site_name: 'Site Alpha',
          contract_id: null,
          contract_name: null,
          client_name: null,
          photosCount: 3,
          anomaliesCount: 0,
          anomaliesResolvedCount: 0,
          validationsCount: 2,
        },
      ],
      total: 2,
    })
    createShareTokenMock.mockResolvedValue({
      id: 'aabbccdd-1122-4334-8556-7788aabbccdd',
      token: 'abc123token',
      intervention_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      created_at: '2026-05-13T10:00:00.000Z',
      created_by: '00000000-0000-4000-8000-000000000001',
      expires_at: '2026-05-20T10:00:00.000Z',
      revoked_at: null,
      include_identities: false,
      last_accessed_at: null,
      access_count: 0,
      contract_id: null,
      report_month: null,
      selected_photo_ids: null,
      dg_note: null,
      closed_at: null,
      closed_by: null,
      closure_note: null,
    })

    const { prepareLitigeDossierAction } = await importAction()
    const res = await prepareLitigeDossierAction({
      siteId: VALID_SITE_ID,
      dateFrom: '2026-05-01',
      dateTo: '2026-05-13',
      includeInterventions: true,
      includePhotos: true,
      includeAnomalies: true,
      includeValidations: true,
    })

    expect(res.ok).toBe(true)
    expect(res.counts).toEqual({
      interventions: 2,
      photos: 8,
      anomalies: 2,
      anomaliesResolved: 1,
      validations: 3,
    })
    expect(res.shareUrl).toMatch(/https:\/\/test\.memoria\.app\/p\/abc123token/)
    expect(res.pdfUrl).toMatch(/^\/litige\/dossier\?/)
    expect(res.pdfUrl).toMatch(/siteId=11111111/)
    expect(res.pdfUrl).toMatch(/dateFrom=2026-05-01/)
    expect(res.pdfUrl).toMatch(/dateTo=2026-05-13/)
    expect(res.pdfUrl).toMatch(/tokenId=aabbccdd/)
    expect(res.expiresAt).toBe('2026-05-20T10:00:00.000Z')

    // Token rattaché à la première intervention (antichrono, la plus récente).
    expect(createShareTokenMock).toHaveBeenCalledTimes(1)
    const call = (createShareTokenMock.mock.calls[0] as unknown[])[0] as {
      interventionId: string
      includeIdentities: boolean
    }
    expect(call.interventionId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(call.includeIdentities).toBe(false)

    // Audit log appelé avec kind=litige_dossier_prepared.
    expect(logAuditEventMock).toHaveBeenCalled()
    const firstCall = logAuditEventMock.mock.calls[0]
    if (!firstCall) throw new Error('audit log not called')
    const auditMeta = firstCall[0].metadata ?? {}
    expect(auditMeta.kind).toBe('litige_dossier_prepared')
    expect(auditMeta.empty).toBe(false)
  })

  it('période vide → counts à 0, pas de token créé, audit empty=true', async () => {
    searchProofsMock.mockResolvedValue({ items: [], total: 0 })

    const { prepareLitigeDossierAction } = await importAction()
    const res = await prepareLitigeDossierAction({
      siteId: VALID_SITE_ID,
      dateFrom: '2026-05-01',
      dateTo: '2026-05-02',
      includeInterventions: true,
      includePhotos: true,
      includeAnomalies: true,
      includeValidations: true,
    })

    expect(res.ok).toBe(true)
    expect(res.counts).toEqual({
      interventions: 0,
      photos: 0,
      anomalies: 0,
      anomaliesResolved: 0,
      validations: 0,
    })
    expect(res.pdfUrl).toBeUndefined()
    expect(res.shareUrl).toBeUndefined()
    expect(createShareTokenMock).not.toHaveBeenCalled()

    expect(logAuditEventMock).toHaveBeenCalledTimes(1)
    const firstCall = logAuditEventMock.mock.calls[0]
    if (!firstCall) throw new Error('audit log not called')
    const auditMeta = firstCall[0].metadata ?? {}
    expect(auditMeta.kind).toBe('litige_dossier_prepared')
    expect(auditMeta.empty).toBe(true)
  })
})

describe('prepareLitigeDossierAction — createShareToken contract', () => {
  it('createShareToken appelé avec interventionId issu de la première intervention (anchor)', async () => {
    searchProofsMock.mockResolvedValue({
      items: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          title: 'Intervention anchor',
          scheduled_for: '2026-05-13',
          scheduled_at: '2026-05-13T09:00:00.000Z',
          executed_at: null,
          status: 'planned',
          skipped_at: null,
          skipped_reason: null,
          mission_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          mission_name: 'Mission A',
          site_id: VALID_SITE_ID,
          site_name: 'Site Alpha',
          contract_id: null,
          contract_name: null,
          client_name: null,
          photosCount: 0,
          anomaliesCount: 0,
          anomaliesResolvedCount: 0,
          validationsCount: 0,
        },
      ],
      total: 1,
    })
    createShareTokenMock.mockResolvedValue({
      id: 'aabbccdd-1122-4334-8556-7788aabbccdd',
      token: 'tok2',
      intervention_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      created_at: '2026-05-13T10:00:00.000Z',
      created_by: null,
      expires_at: '2026-05-20T10:00:00.000Z',
      revoked_at: null,
      include_identities: false,
      last_accessed_at: null,
      access_count: 0,
      contract_id: null,
      report_month: null,
      selected_photo_ids: null,
      dg_note: null,
      closed_at: null,
      closed_by: null,
      closure_note: null,
    })

    const { prepareLitigeDossierAction } = await importAction()
    const res = await prepareLitigeDossierAction({
      siteId: VALID_SITE_ID,
      dateFrom: '2026-05-13',
      dateTo: '2026-05-13',
      includeInterventions: true,
      includePhotos: true,
      includeAnomalies: true,
      includeValidations: true,
    })

    expect(res.ok).toBe(true)
    expect(createShareTokenMock).toHaveBeenCalledTimes(1)
    const arg = (createShareTokenMock.mock.calls[0] as unknown[])[0] as {
      interventionId: string
      includeIdentities: boolean
      durationDays: number
      createdBy: string | null
    }
    expect(arg.interventionId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    expect(arg.includeIdentities).toBe(false)
    expect(arg.durationDays).toBe(7)
    // createdBy = id du user mocké (admin).
    expect(arg.createdBy).toBe('00000000-0000-4000-8000-000000000001')
  })
})
