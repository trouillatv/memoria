import { beforeEach, describe, expect, it, vi } from 'vitest'

// P0-1 (Vincent 2026-09-23) — Document contractuel depuis la fiche chantier.
// uploadSiteDocumentAction est le point d'entrée réutilisé (aucune nouvelle
// server action) : ces tests verrouillent que le document_type choisi dans le
// dialogue (cctp/ccap/ordre_service) est transmis tel quel à uploadDocumentAction
// — jamais réécrit vers 'ao' ou 'reference' — et que target_type/target_id
// restent forcés au chantier courant (aucun sélecteur de cible générique). La
// garde cross-org elle-même est couverte, agnostique du document_type, par
// tests/actions/document-upload-org-guard.test.ts.

const AGP_SITE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const AGP_COLLECTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

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
  uploadDocumentAction.mockClear()
  uploadDocumentAction.mockResolvedValue({ ok: true, documentId: 'doc-1' })
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
