import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

// P0 cross-org (Vincent, review ChatGPT sur commit 42281128 — verdict
// FIX_REQUIRED, 2026-09-23). uploadDocumentAction ne doit JAMAIS laisser une
// collection d'une organisation alimenter un document rattaché à un chantier
// d'une autre organisation, et le dédoublonnage par content_hash ne doit
// jamais franchir cette frontière (Doctrine M3 : l'organisation d'un document
// est toujours celle de sa collection, jamais de la session).
//
// Scénarios couverts (lettres Vincent) :
//   C. Appel forgé (collection CAPSE + chantier AGP) → refus serveur, rien créé.
//   D. Dédoublonnage cross-org (hash déjà CAPSE, import AGP) → nouveau nœud AGP.
//   E. Dédoublonnage intra-org (hash déjà AGP) → réutilisation normale (non-régression).
//   F. Parcours Guillaume : chantier AGP neuf, 0 collection AGP, création puis
//      import immédiat → document et lien AGP.
// (A/B — restriction des collections proposées à l'import contextualisé —
// couverts par tests/doctrine/documents-import-org-context.doctrine.test.ts)

const AGP = '33333333-3333-3333-3333-333333333333'
const CAPSE = '44444444-4444-4444-4444-444444444444'
// collection_id / target_id passent par z.string().uuid() (version+variant requis).
const AGP_COLLECTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CAPSE_COLLECTION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const AGP_SITE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NEW_AGP_COLLECTION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

let collectionOrgs: Record<string, string> = {
  [AGP_COLLECTION]: AGP,
  [CAPSE_COLLECTION]: CAPSE,
}
let existingDocsByOrgAndHash: Record<string, { id: string; filename: string }> = {}
let orgIdsOfUser: string[] = [AGP, CAPSE]

const sitesById: Record<string, { organization_id: string | null }> = {
  [AGP_SITE]: { organization_id: AGP },
}

const getUser = vi.fn()
const getUserRoleById = vi.fn()
const createDocument = vi.fn(async () => 'new-doc-id')
const addDocumentLink = vi.fn(async () => {})
const createDocumentCollection = vi.fn(async () => NEW_AGP_COLLECTION)
const storageUpload = vi.fn(async () => ({ error: null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => getUser() },
  }),
}))
vi.mock('@/lib/db/users', () => ({
  getUserRoleById: (...args: unknown[]) => getUserRoleById(...args),
}))
vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: async () => orgIdsOfUser,
}))
vi.mock('@/lib/db/sites', () => ({
  getSiteById: async (id: string) => sitesById[id] ?? null,
}))
vi.mock('@/lib/db/documents', () => ({
  createDocument: (...args: unknown[]) => createDocument(...args),
  addDocumentLink: (...args: unknown[]) => addDocumentLink(...args),
  createDocumentCollection: (...args: unknown[]) => createDocumentCollection(...args),
  updateDocumentAnalysisStatus: vi.fn(),
  softDeleteDocument: vi.fn(),
  getDocument: vi.fn(),
  moveDocumentToCollection: vi.fn(),
  renameDocumentCollection: vi.fn(),
  reorderDocumentCollections: vi.fn(),
  deleteDocumentCollection: vi.fn(),
  getCollectionOrganizationId: async (collectionId: string) => collectionOrgs[collectionId] ?? null,
  findDocumentByHashInOrg: async (contentHash: string, organizationId: string) =>
    existingDocsByOrgAndHash[`${organizationId}:${contentHash}`] ?? null,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ upload: (...args: unknown[]) => storageUpload(...args) }) },
  }),
}))
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/documents/analyze', () => ({ analyzeDocument: vi.fn() }))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: vi.fn() }
})

const { uploadDocumentAction, createDocumentCollectionAction } = await import(
  '@/app/(dashboard)/documents/actions'
)

function hashOf(content: string): string {
  return createHash('sha256').update(Buffer.from(content)).digest('hex')
}

function registerExistingDoc(organizationId: string, content: string, doc: { id: string; filename: string }) {
  existingDocsByOrgAndHash[`${organizationId}:${hashOf(content)}`] = doc
}

function pdfFormData(content: string, fields: Record<string, string>): FormData {
  const fd = new FormData()
  fd.set('file', new File([content], 'facture.pdf', { type: 'application/pdf' }))
  fd.set('document_type', 'autre')
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  collectionOrgs = { [AGP_COLLECTION]: AGP, [CAPSE_COLLECTION]: CAPSE }
  existingDocsByOrgAndHash = {}
  orgIdsOfUser = [AGP, CAPSE]
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  getUserRoleById.mockResolvedValue('manager')
  createDocument.mockResolvedValue('new-doc-id')
  createDocumentCollection.mockResolvedValue(NEW_AGP_COLLECTION)
  storageUpload.mockResolvedValue({ error: null })
})

describe('C — appel forgé : collection CAPSE + chantier AGP', () => {
  it('refuse côté serveur, aucun document ni lien créé', async () => {
    const fd = pdfFormData('contenu-facture-forgee', {
      collection_id: CAPSE_COLLECTION,
      target_type: 'site',
      target_id: AGP_SITE,
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Organisation de la collection et du chantier incompatibles')
    expect(storageUpload).not.toHaveBeenCalled()
    expect(createDocument).not.toHaveBeenCalled()
    expect(addDocumentLink).not.toHaveBeenCalled()
  })
})

describe('D — dédoublonnage cross-org : hash déjà CAPSE, import AGP', () => {
  it('ne réutilise jamais le document CAPSE ; crée un nœud AGP distinct', async () => {
    registerExistingDoc(CAPSE, 'contenu-partage-cross-org', { id: 'capse-doc-1', filename: 'facture.pdf' })

    const fd = pdfFormData('contenu-partage-cross-org', {
      collection_id: AGP_COLLECTION,
      target_type: 'site',
      target_id: AGP_SITE,
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.documentId).toBe('new-doc-id')
      expect(r.duplicate).not.toBe(true)
    }
    expect(createDocument).toHaveBeenCalledTimes(1)
    expect(addDocumentLink).toHaveBeenCalledWith('new-doc-id', 'site', AGP_SITE)
  })
})

describe('E — dédoublonnage intra-org : hash déjà AGP (non-régression)', () => {
  it('réutilise le nœud AGP existant, ne crée pas de doublon', async () => {
    registerExistingDoc(AGP, 'contenu-deja-importe-agp', { id: 'agp-doc-1', filename: 'facture.pdf' })

    const fd = pdfFormData('contenu-deja-importe-agp', {
      collection_id: AGP_COLLECTION,
      target_type: 'site',
      target_id: AGP_SITE,
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.documentId).toBe('agp-doc-1')
      expect(r.duplicate).toBe(true)
    }
    expect(createDocument).not.toHaveBeenCalled()
    expect(addDocumentLink).toHaveBeenCalledWith('agp-doc-1', 'site', AGP_SITE)
  })
})

describe('F — parcours Guillaume : chantier AGP neuf, 0 collection AGP', () => {
  it('création immédiate de la collection AGP puis import réussi, document et lien AGP', async () => {
    const collectionFd = new FormData()
    collectionFd.set('name', 'Procédures AGP')
    collectionFd.set('organization_id', AGP)
    const collectionResult = await createDocumentCollectionAction(collectionFd)
    expect(collectionResult.ok).toBe(true)

    collectionOrgs[NEW_AGP_COLLECTION] = AGP

    const uploadFd = pdfFormData('contenu-guillaume', {
      collection_id: NEW_AGP_COLLECTION,
      target_type: 'site',
      target_id: AGP_SITE,
    })
    const r = await uploadDocumentAction(uploadFd)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.documentId).toBe('new-doc-id')
    expect(addDocumentLink).toHaveBeenCalledWith('new-doc-id', 'site', AGP_SITE)
  })
})
