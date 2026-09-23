import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

// P0-1 micro-fix (Vincent 2026-09-24) — la déduplication par content_hash
// réutilisait le nœud documentaire existant sans jamais tenir compte des
// métadonnées apportées par le nouvel import. Recette Vincent : réimporter
// EXACTEMENT le même PDF déjà connu en 'preuve'/effective_date=NULL via le
// flux "Document contractuel" (type=cctp, date=24/09/2026) laissait le
// document stale (toujours 'preuve', toujours sans date).
//
// Principe produit (Vincent) : « Le hash répond : Est-ce le même fichier ?
// Le nouvel import répond : Que sait maintenant l'humain sur ce fichier ?
// La déduplication ne doit donc pas empêcher l'enrichissement documentaire. »
//
// Règles couvertes ici :
//   - type générique (preuve/autre) → type spécifique explicite : enrichi.
//   - effective_date NULL → date fournie : complétée.
//   - type spécifique → même type spécifique : idempotent, aucune écriture.
//   - type spécifique existant → type spécifique différent : conflit, pas d'écrasement.
//   - date existante → date différente : conflit, pas d'écrasement.
//   - même filename mais hash différent : jamais dédoublonné par nom, nouveau document.
//   - non-régression cross-org : l'enrichissement ne franchit jamais une frontière d'organisation.

const AGP = '33333333-3333-3333-3333-333333333333'
const CAPSE = '44444444-4444-4444-4444-444444444444'
const AGP_COLLECTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CAPSE_COLLECTION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const AGP_SITE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

let collectionOrgs: Record<string, string> = {
  [AGP_COLLECTION]: AGP,
  [CAPSE_COLLECTION]: CAPSE,
}
let existingDocsByOrgAndHash: Record<
  string,
  { id: string; filename: string; document_type?: string; effective_date?: string | null }
> = {}
let orgIdsOfUser: string[] = [AGP, CAPSE]
let orgRoles: Record<string, string> = { [AGP]: 'manager', [CAPSE]: 'manager' }

const sitesById: Record<string, { organization_id: string | null }> = {
  [AGP_SITE]: { organization_id: AGP },
}

const getUser = vi.fn()
const getUserRoleById = vi.fn()
const createDocument = vi.fn(async (..._args: unknown[]) => 'new-doc-id')
const addDocumentLink = vi.fn(async (..._args: unknown[]) => {})
const updateDocumentMetadata = vi.fn(async (..._args: unknown[]) => {})
const logAuditEvent = vi.fn(async (..._args: unknown[]) => {})
const storageUpload = vi.fn(async (..._args: unknown[]) => ({ error: null }))

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
  ACCES_REFUSE: 'Accès refusé',
  requireOrganizationMembership: async (organizationId: string) =>
    orgIdsOfUser.includes(organizationId)
      ? { ok: true, context: { userId: 'user-1', organizationId, role: orgRoles[organizationId] ?? 'manager' } }
      : { ok: false, error: 'Accès refusé' },
}))
vi.mock('@/lib/db/sites', () => ({
  getSiteById: async (id: string) => sitesById[id] ?? null,
}))
vi.mock('@/lib/db/documents', () => ({
  createDocument: (...args: unknown[]) => createDocument(...args),
  addDocumentLink: (...args: unknown[]) => addDocumentLink(...args),
  updateDocumentMetadata: (...args: unknown[]) => updateDocumentMetadata(...args),
  createDocumentCollection: vi.fn(),
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
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: (...args: unknown[]) => logAuditEvent(...args) }))
vi.mock('@/lib/documents/analyze', () => ({ analyzeDocument: vi.fn() }))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: vi.fn() }
})

const { uploadDocumentAction } = await import('@/app/(dashboard)/documents/actions')

function hashOf(content: string): string {
  return createHash('sha256').update(Buffer.from(content)).digest('hex')
}

function registerExistingDoc(
  organizationId: string,
  content: string,
  doc: { id: string; filename: string; document_type?: string; effective_date?: string | null },
) {
  existingDocsByOrgAndHash[`${organizationId}:${hashOf(content)}`] = doc
}

function pdfFormData(
  content: string,
  documentType: string,
  fields: Record<string, string> = {},
  filename = 'CCTP.pdf',
): FormData {
  const fd = new FormData()
  fd.set('file', new File([content], filename, { type: 'application/pdf' }))
  fd.set('document_type', documentType)
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  collectionOrgs = { [AGP_COLLECTION]: AGP, [CAPSE_COLLECTION]: CAPSE }
  existingDocsByOrgAndHash = {}
  orgIdsOfUser = [AGP, CAPSE]
  orgRoles = { [AGP]: 'manager', [CAPSE]: 'manager' }
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  getUserRoleById.mockResolvedValue('manager')
  createDocument.mockResolvedValue('new-doc-id')
  storageUpload.mockResolvedValue({ error: null })
})

describe('Réimport même hash : preuve → type contractuel explicite', () => {
  it('enrichit le document existant (même id), aucun second upload', async () => {
    registerExistingDoc(AGP, 'contenu-cctp-ocef', {
      id: 'agp-doc-1',
      filename: 'CCTP_demo_OCEF_MemorIA.pdf',
      document_type: 'preuve',
      effective_date: null,
    })

    const fd = pdfFormData('contenu-cctp-ocef', 'cctp', {
      collection_id: AGP_COLLECTION,
      target_type: 'site',
      target_id: AGP_SITE,
      effective_date: '2026-09-24',
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.documentId).toBe('agp-doc-1')
      expect(r.duplicate).toBe(true)
      expect(r.enriched).toBe(true)
      expect(r.metadataConflict).not.toBe(true)
    }
    expect(createDocument).not.toHaveBeenCalled()
    expect(storageUpload).not.toHaveBeenCalled()
    expect(updateDocumentMetadata).toHaveBeenCalledTimes(1)
    expect(updateDocumentMetadata).toHaveBeenCalledWith('agp-doc-1', {
      document_type: 'cctp',
      effective_date: '2026-09-24',
    })
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'document',
        entityId: 'agp-doc-1',
        action: 'updated',
        metadata: expect.objectContaining({ kind: 'metadata_enriched' }),
      }),
    )
  })
})

describe('effective_date NULL → date fournie', () => {
  it('complète la date sans toucher un type déjà spécifique identique', async () => {
    registerExistingDoc(AGP, 'contenu-cctp-date-nulle', {
      id: 'agp-doc-2',
      filename: 'CCTP.pdf',
      document_type: 'cctp',
      effective_date: null,
    })

    const fd = pdfFormData('contenu-cctp-date-nulle', 'cctp', {
      collection_id: AGP_COLLECTION,
      effective_date: '2026-09-01',
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.enriched).toBe(true)
    expect(updateDocumentMetadata).toHaveBeenCalledWith('agp-doc-2', { effective_date: '2026-09-01' })
  })
})

describe('cctp → cctp : idempotent', () => {
  it('aucune écriture, aucun audit, no-op silencieux', async () => {
    registerExistingDoc(AGP, 'contenu-cctp-stable', {
      id: 'agp-doc-3',
      filename: 'CCTP.pdf',
      document_type: 'cctp',
      effective_date: '2026-09-01',
    })

    const fd = pdfFormData('contenu-cctp-stable', 'cctp', {
      collection_id: AGP_COLLECTION,
      effective_date: '2026-09-01',
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.enriched).toBeFalsy()
      expect(r.metadataConflict).toBeFalsy()
    }
    expect(updateDocumentMetadata).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})

describe('Type spécifique existant ≠ nouveau type spécifique', () => {
  it('ne pas écraser silencieusement : conflit signalé, valeur existante conservée', async () => {
    registerExistingDoc(AGP, 'contenu-contrat-vs-cctp', {
      id: 'agp-doc-4',
      filename: 'doc.pdf',
      document_type: 'contrat',
      effective_date: null,
    })

    const fd = pdfFormData('contenu-contrat-vs-cctp', 'cctp', {
      collection_id: AGP_COLLECTION,
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metadataConflict).toBe(true)
      expect(r.enriched).toBeFalsy()
    }
    expect(updateDocumentMetadata).not.toHaveBeenCalled()
  })
})

describe('Date d’effet existante ≠ nouvelle date', () => {
  it('ne pas écraser silencieusement : conflit signalé, date existante conservée', async () => {
    registerExistingDoc(AGP, 'contenu-date-conflit', {
      id: 'agp-doc-5',
      filename: 'doc.pdf',
      document_type: 'cctp',
      effective_date: '2026-09-01',
    })

    const fd = pdfFormData('contenu-date-conflit', 'cctp', {
      collection_id: AGP_COLLECTION,
      effective_date: '2026-10-15',
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metadataConflict).toBe(true)
      expect(r.enriched).toBeFalsy()
    }
    expect(updateDocumentMetadata).not.toHaveBeenCalled()
  })
})

describe('Même nom de fichier mais contenu différent', () => {
  it('n’est jamais dédoublonné par filename : nouveau document créé', async () => {
    registerExistingDoc(AGP, 'contenu-original', {
      id: 'agp-doc-6',
      filename: 'CCTP.pdf',
      document_type: 'cctp',
      effective_date: '2026-09-01',
    })

    const fd = pdfFormData('contenu-different-meme-nom', 'cctp', {
      collection_id: AGP_COLLECTION,
    }, 'CCTP.pdf')
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.documentId).toBe('new-doc-id')
      expect(r.duplicate).not.toBe(true)
    }
    expect(createDocument).toHaveBeenCalledTimes(1)
    expect(updateDocumentMetadata).not.toHaveBeenCalled()
  })
})

describe('Non-régression cross-org', () => {
  it('un document preuve/NULL chez CAPSE n’est jamais enrichi par un import AGP du même contenu', async () => {
    registerExistingDoc(CAPSE, 'contenu-partage-cross-org', {
      id: 'capse-doc-1',
      filename: 'doc.pdf',
      document_type: 'preuve',
      effective_date: null,
    })

    const fd = pdfFormData('contenu-partage-cross-org', 'cctp', {
      collection_id: AGP_COLLECTION,
      effective_date: '2026-09-01',
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.documentId).toBe('new-doc-id')
      expect(r.duplicate).not.toBe(true)
    }
    expect(createDocument).toHaveBeenCalledTimes(1)
    expect(updateDocumentMetadata).not.toHaveBeenCalled()
  })
})
