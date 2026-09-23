import { beforeEach, describe, expect, it, vi } from 'vitest'

// P0-1 (Vincent 2026-09-23) — Document contractuel depuis la fiche chantier.
// uploadSiteDocumentAction est le point d'entrée réutilisé (aucune nouvelle
// server action) : ces tests verrouillent que le document_type choisi dans le
// dialogue (cctp/ccap/ordre_service) est transmis tel quel à uploadDocumentAction
// — jamais réécrit vers 'ao' ou 'reference' — et que target_type/target_id
// restent forcés au chantier courant (aucun sélecteur de cible générique).
//
// Review ChatGPT sur 533abf88 (verdict FIX_REQUIRED) : ensureSiteCollection()
// pouvait créer une collection "Documents chantier" (écriture DB) AVANT le
// garde manager/admin de uploadDocumentAction — createDocumentCollection() ne
// vérifie que l'appartenance, jamais le rôle contextuel. uploadSiteDocumentAction
// vérifie désormais requireOrganizationRole(site.organization_id, ['manager',
// 'admin']) avant tout effet de bord. Les scénarios rôle insuffisant / non-membre
// ci-dessous verrouillent que ni createDocumentCollection ni uploadDocumentAction
// ne sont jamais appelés dans ce cas. La garde cross-org du couple
// collection/chantier reste couverte, agnostique du document_type, par
// tests/actions/document-upload-org-guard.test.ts.

const AGP_SITE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const AGP_ORG = '33333333-3333-3333-3333-333333333333'
const AGP_COLLECTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const sitesById: Record<string, { organization_id: string | null }> = {
  [AGP_SITE]: { organization_id: AGP_ORG },
}
// Rôle DANS l'organisation du chantier — c'est lui qui fait autorité, jamais
// un rôle global.
let orgRole: string | null = 'manager'

const getSiteById = vi.fn(async (id: string) => sitesById[id] ?? null)
const uploadDocumentAction = vi.fn(async (_fd: FormData) => ({ ok: true, documentId: 'doc-1' }))
const listDocumentCollections = vi.fn(async () => [
  { id: AGP_COLLECTION, scope_type: 'site', scope_id: AGP_SITE },
])
const createDocumentCollection = vi.fn(async () => AGP_COLLECTION)

vi.mock('@/app/(dashboard)/documents/actions', () => ({
  uploadDocumentAction: (fd: FormData) => uploadDocumentAction(fd),
}))
vi.mock('@/lib/db/documents', () => ({
  listDocumentCollections: () => listDocumentCollections(),
  createDocumentCollection: () => createDocumentCollection(),
}))
vi.mock('@/lib/db/sites', () => ({
  getSiteById: (id: string) => getSiteById(id),
}))
vi.mock('@/lib/auth/memberships', () => ({
  ACCES_REFUSE: 'Accès refusé',
  requireOrganizationRole: async (organizationId: string, allowedRoles: readonly string[]) => {
    if (organizationId !== AGP_ORG || !orgRole) return { ok: false, error: 'Accès refusé' }
    if (!allowedRoles.includes(orgRole)) return { ok: false, error: 'Accès refusé' }
    return { ok: true, context: { userId: 'user-1', organizationId, role: orgRole } }
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  }),
}))
vi.mock('@/lib/db/users', () => ({
  getUserRoleById: vi.fn(async () => 'manager'),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { uploadSiteDocumentAction } = await import('@/app/(dashboard)/sites/[id]/site-add-actions')

beforeEach(() => {
  vi.clearAllMocks()
  orgRole = 'manager'
  getSiteById.mockImplementation(async (id: string) => sitesById[id] ?? null)
  uploadDocumentAction.mockResolvedValue({ ok: true, documentId: 'doc-1' })
  listDocumentCollections.mockResolvedValue([
    { id: AGP_COLLECTION, scope_type: 'site', scope_id: AGP_SITE },
  ])
  createDocumentCollection.mockResolvedValue(AGP_COLLECTION)
})

function contractualFormData(documentType: string, effectiveDate?: string): FormData {
  const fd = new FormData()
  fd.set('file', new File(['contenu-cctp'], 'CCTP.pdf', { type: 'application/pdf' }))
  fd.set('document_type', documentType)
  fd.set('visibility_level', 'manager')
  fd.set('embed', 'true')
  fd.set('memory_tier', 'consultable')
  if (effectiveDate) fd.set('effective_date', effectiveDate)
  return fd
}

describe('uploadSiteDocumentAction — document contractuel (CCTP/CCAP/ordre de service)', () => {
  it('transmet document_type=cctp tel quel, jamais réécrit vers ao ou reference', async () => {
    await uploadSiteDocumentAction(AGP_SITE, contractualFormData('cctp'))
    expect(uploadDocumentAction).toHaveBeenCalledTimes(1)
    const sentFd = uploadDocumentAction.mock.calls[0]![0] as FormData
    expect(sentFd.get('document_type')).toBe('cctp')
  })

  it('force target_type=site et target_id=chantier courant (aucun sélecteur de cible générique)', async () => {
    await uploadSiteDocumentAction(AGP_SITE, contractualFormData('ccap'))
    const sentFd = uploadDocumentAction.mock.calls[0]![0] as FormData
    expect(sentFd.get('target_type')).toBe('site')
    expect(sentFd.get('target_id')).toBe(AGP_SITE)
  })

  it('transmet la date d’effet optionnelle quand fournie', async () => {
    await uploadSiteDocumentAction(AGP_SITE, contractualFormData('ordre_service', '2026-09-01'))
    const sentFd = uploadDocumentAction.mock.calls[0]![0] as FormData
    expect(sentFd.get('effective_date')).toBe('2026-09-01')
  })

  it('n’envoie pas effective_date quand absente (pas de champ vide parasite)', async () => {
    await uploadSiteDocumentAction(AGP_SITE, contractualFormData('cctp'))
    const sentFd = uploadDocumentAction.mock.calls[0]![0] as FormData
    expect(sentFd.get('effective_date')).toBeNull()
  })
})

describe('uploadSiteDocumentAction — garde rôle AVANT effet de bord (review ChatGPT 533abf88)', () => {
  it('rôle insuffisant (chef_equipe) DANS l’organisation du chantier → refus, aucune collection créée, uploadDocumentAction jamais appelé', async () => {
    orgRole = 'chef_equipe'
    const result = await uploadSiteDocumentAction(AGP_SITE, contractualFormData('cctp'))
    expect(result.ok).toBe(false)
    expect(createDocumentCollection).not.toHaveBeenCalled()
    expect(listDocumentCollections).not.toHaveBeenCalled()
    expect(uploadDocumentAction).not.toHaveBeenCalled()
  })

  it('non-membre de l’organisation du chantier → même refus, même absence totale d’effet de bord', async () => {
    orgRole = null
    const result = await uploadSiteDocumentAction(AGP_SITE, contractualFormData('cctp'))
    expect(result.ok).toBe(false)
    expect(createDocumentCollection).not.toHaveBeenCalled()
    expect(uploadDocumentAction).not.toHaveBeenCalled()
  })

  it('rôle manager DANS l’organisation du chantier → flux autorisé normalement', async () => {
    orgRole = 'manager'
    const result = await uploadSiteDocumentAction(AGP_SITE, contractualFormData('cctp'))
    expect(result.ok).toBe(true)
    expect(uploadDocumentAction).toHaveBeenCalledTimes(1)
  })

  it('la garde repose sur le rôle CONTEXTUEL (chantier), jamais un rôle global : chef_equipe côté chantier refuse même si getUserRoleById répondait manager', async () => {
    orgRole = 'chef_equipe'
    // getUserRoleById (rôle global, mocké 'manager' par défaut) n'est jamais
    // consulté par uploadSiteDocumentAction : seul requireOrganizationRole
    // (rôle DANS l'organisation du chantier) fait autorité.
    const result = await uploadSiteDocumentAction(AGP_SITE, contractualFormData('cctp'))
    expect(result.ok).toBe(false)
  })
})
