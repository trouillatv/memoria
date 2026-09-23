import { beforeEach, describe, expect, it, vi } from 'vitest'

// BUG UX BLOQUANT (Vincent 2026-09-23) — createDocumentCollectionAction
// dupliquait la résolution 0/1/many au lieu de réutiliser resolveCreationOrgId
// (lib/auth/creation-org.ts, le SEUL endroit qui décide). Ces tests protègent
// le comportement serveur maintenant aligné sur ce helper canonique : mono-org
// jamais bloqué, multi-org avec organisation transmise accepté, multi-org sans
// organisation refusé explicitement (jamais un blocage muet), organisation hors
// appartenances jamais acceptée en confiance.

let orgIds: string[] = []
const createDocumentCollection = vi.fn(async () => 'new-collection-id')

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  }),
}))
vi.mock('@/lib/db/users', () => ({
  getUserRoleById: vi.fn(async () => 'manager'),
}))
vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: async () => orgIds,
  ACCES_REFUSE: 'Accès refusé',
  requireOrganizationMembership: async (organizationId: string) =>
    orgIds.includes(organizationId)
      ? { ok: true, context: { userId: 'user-1', organizationId, role: 'manager' } }
      : { ok: false, error: 'Accès refusé' },
}))
vi.mock('@/lib/db/documents', () => ({
  createDocumentCollection,
  createDocument: vi.fn(),
  addDocumentLink: vi.fn(),
  updateDocumentAnalysisStatus: vi.fn(),
  softDeleteDocument: vi.fn(),
  getDocument: vi.fn(),
  moveDocumentToCollection: vi.fn(),
  renameDocumentCollection: vi.fn(),
  reorderDocumentCollections: vi.fn(),
  deleteDocumentCollection: vi.fn(),
}))
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/documents/analyze', () => ({ analyzeDocument: vi.fn() }))

const { createDocumentCollectionAction } = await import('@/app/(dashboard)/documents/actions')

const AGP = '33333333-3333-3333-3333-333333333333'
const CAPSE = '44444444-4444-4444-4444-444444444444'

function fd(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  orgIds = []
  createDocumentCollection.mockClear()
})

describe('createDocumentCollectionAction — organisation jamais bloquante', () => {
  it('mono-org : création possible sans champ organization_id (auto-sélection silencieuse)', async () => {
    orgIds = [AGP]
    const r = await createDocumentCollectionAction(fd({ name: 'Procédures CHT' }))
    expect(r.ok).toBe(true)
    expect(createDocumentCollection).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: AGP }),
    )
  })

  it('multi-org + organisation transmise (site contextualisé ou sélecteur) → succès', async () => {
    orgIds = [AGP, CAPSE]
    const r = await createDocumentCollectionAction(fd({ name: 'Sécurité', organization_id: AGP }))
    expect(r.ok).toBe(true)
    expect(createDocumentCollection).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: AGP }),
    )
  })

  it('multi-org SANS organisation transmise → refus explicite, jamais une création silencieuse', async () => {
    orgIds = [AGP, CAPSE]
    const r = await createDocumentCollectionAction(fd({ name: 'Sécurité' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Sélectionnez une organisation')
    expect(createDocumentCollection).not.toHaveBeenCalled()
  })

  it('organisation transmise hors appartenances → refus, jamais acceptée en confiance', async () => {
    orgIds = [AGP]
    const r = await createDocumentCollectionAction(fd({ name: 'Sécurité', organization_id: CAPSE }))
    expect(r.ok).toBe(false)
    expect(createDocumentCollection).not.toHaveBeenCalled()
  })
})
