import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { ReplaceCandidateValidation } from '@/lib/db/documents'

// P0-1B2 versioning documentaire (Vincent 2026-09-24). Même chantier + même
// filename + hash différent = candidat à une nouvelle version, jamais tranché
// en silence :
//   - aucun version_decision -> refus + signal versionConflict, ZÉRO effet de
//     bord (pas de Storage, pas de createDocument) ;
//   - version_decision='update' -> nouveau document créé avec
//     supersedes_document_id, ancienne version basculée 'superseded' ;
//   - version_decision='keep_both' -> les deux versions restent actives, la
//     collision n'est même pas consultée ;
//   - filename différent -> jamais cette logique (aucune association
//     automatique par similarité).
//
// Tous les imports de ce fichier ciblent explicitement un chantier
// (target_type='site') : la recherche de collision passe donc par
// findFilenameCollisionForSite (P0-1B2 revue FIX_REQUIRED, Vincent
// 2026-09-24, tâche 3), pas par findFilenameCollisionInCollection —
// `collection_id` n'étant pas une identité fiable du chantier.

const ORG = '33333333-3333-3333-3333-333333333333'
const COLLECTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SITE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const EXISTING_DOC_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

type CollisionLookup =
  | { status: 'none' }
  | { status: 'found'; id: string; filename: string; document_type: string }
  | { status: 'ambiguous'; ids: string[] }

let collectionOrgs: Record<string, string> = { [COLLECTION]: ORG }
let collisionBySiteAndFilename: Record<string, CollisionLookup> = {}

const sitesById: Record<string, { organization_id: string | null }> = {
  [SITE]: { organization_id: ORG },
}

const getUser = vi.fn()
const getUserRoleById = vi.fn()
const createDocument = vi.fn(async (..._args: unknown[]) => 'new-doc-id')
const addDocumentLink = vi.fn(async (..._args: unknown[]) => {})
const copyDocumentLinks = vi.fn(async (..._args: unknown[]) => {})
const softDeleteDocument = vi.fn(async (..._args: unknown[]) => {})
const findFilenameCollisionInCollection = vi.fn(
  async (..._args: unknown[]): Promise<CollisionLookup> => ({ status: 'none' }),
)
const findFilenameCollisionForSite = vi.fn(
  async (filename: string, siteId: string, _contentHash: string): Promise<CollisionLookup> =>
    collisionBySiteAndFilename[`${siteId}:${filename}`] ?? { status: 'none' },
)
const validateReplaceCandidateForSite = vi.fn(
  async (..._args: unknown[]): Promise<ReplaceCandidateValidation> => ({ status: 'not_found' }),
)
const markDocumentSuperseded = vi.fn(async (..._args: unknown[]) => {})
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
  getOrgIdsOfUser: async () => [ORG],
  ACCES_REFUSE: 'Accès refusé',
  requireOrganizationMembership: async (organizationId: string) =>
    organizationId === ORG
      ? { ok: true, context: { userId: 'user-1', organizationId, role: 'manager' } }
      : { ok: false, error: 'Accès refusé' },
}))
vi.mock('@/lib/db/sites', () => ({
  getSiteById: async (id: string) => sitesById[id] ?? null,
}))
vi.mock('@/lib/db/documents', () => ({
  createDocument: (...args: unknown[]) => createDocument(...args),
  addDocumentLink: (...args: unknown[]) => addDocumentLink(...args),
  copyDocumentLinks: (...args: unknown[]) => copyDocumentLinks(...args),
  createDocumentCollection: vi.fn(),
  updateDocumentAnalysisStatus: vi.fn(),
  softDeleteDocument: (...args: unknown[]) => softDeleteDocument(...args),
  getDocument: vi.fn(),
  moveDocumentToCollection: vi.fn(),
  renameDocumentCollection: vi.fn(),
  reorderDocumentCollections: vi.fn(),
  deleteDocumentCollection: vi.fn(),
  getCollectionOrganizationId: async (collectionId: string) => collectionOrgs[collectionId] ?? null,
  findDocumentByHashInOrg: async (..._args: unknown[]) => ({ status: 'none' as const }),
  findFilenameCollisionInCollection: (...args: [string, string, string]) =>
    findFilenameCollisionInCollection(...args),
  findFilenameCollisionForSite: (...args: [string, string, string]) =>
    findFilenameCollisionForSite(...args),
  validateReplaceCandidateForSite: (...args: unknown[]) => validateReplaceCandidateForSite(...args),
  markDocumentSuperseded: (...args: unknown[]) => markDocumentSuperseded(...args),
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

const { uploadDocumentAction } = await import('@/app/(dashboard)/documents/actions')

function hashOf(content: string): string {
  return createHash('sha256').update(Buffer.from(content)).digest('hex')
}

function pdfFormData(
  filename: string,
  content: string,
  fields: Record<string, string> = {},
): FormData {
  const fd = new FormData()
  fd.set('file', new File([content], filename, { type: 'application/pdf' }))
  fd.set('document_type', 'autre')
  fd.set('collection_id', COLLECTION)
  fd.set('target_type', 'site')
  fd.set('target_id', SITE)
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  collectionOrgs = { [COLLECTION]: ORG }
  collisionBySiteAndFilename = {}
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  getUserRoleById.mockResolvedValue('manager')
  createDocument.mockResolvedValue('new-doc-id')
  storageUpload.mockResolvedValue({ error: null })
})

describe('collision filename + hash différent, aucun version_decision', () => {
  it('refuse et signale versionConflict, sans aucun effet de bord', async () => {
    collisionBySiteAndFilename[`${SITE}:facture.pdf`] = {
      status: 'found',
      id: EXISTING_DOC_ID,
      filename: 'facture.pdf',
      document_type: 'autre',
    }

    const fd = pdfFormData('facture.pdf', hashOf('nouveau-contenu'))
    // hash != contenu déjà existant -> pas de dédup, on atteint le contrôle de version
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.versionConflict).toBe(true)
      expect(r.existingDocumentId).toBe(EXISTING_DOC_ID)
    }
    expect(storageUpload).not.toHaveBeenCalled()
    expect(createDocument).not.toHaveBeenCalled()
    expect(markDocumentSuperseded).not.toHaveBeenCalled()
  })
})

describe('version_decision=update', () => {
  it('crée un nouveau document avec supersedes_document_id et bascule l’ancienne version', async () => {
    collisionBySiteAndFilename[`${SITE}:facture.pdf`] = {
      status: 'found',
      id: EXISTING_DOC_ID,
      filename: 'facture.pdf',
      document_type: 'autre',
    }

    const fd = pdfFormData('facture.pdf', 'contenu-v2', { version_decision: 'update' })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.documentId).toBe('new-doc-id')
      expect(r.versioned).toBe(true)
    }
    expect(createDocument).toHaveBeenCalledTimes(1)
    expect(createDocument.mock.calls[0][0]).toMatchObject({
      supersedes_document_id: EXISTING_DOC_ID,
    })
    // Invariant A : la nouvelle version est installée (liens copiés + lien
    // courant) AVANT que l'ancienne soit basculée superseded.
    expect(copyDocumentLinks).toHaveBeenCalledWith(EXISTING_DOC_ID, 'new-doc-id')
    expect(addDocumentLink).toHaveBeenCalledWith('new-doc-id', 'site', SITE)
    expect(markDocumentSuperseded).toHaveBeenCalledWith(EXISTING_DOC_ID)
    expect(markDocumentSuperseded.mock.invocationCallOrder[0]).toBeGreaterThan(
      copyDocumentLinks.mock.invocationCallOrder[0],
    )
    expect(markDocumentSuperseded.mock.invocationCallOrder[0]).toBeGreaterThan(
      addDocumentLink.mock.invocationCallOrder[0],
    )
    expect(softDeleteDocument).not.toHaveBeenCalled()
  })
})

describe('version_decision=update, échec de markDocumentSuperseded (invariant B)', () => {
  it('ne renvoie jamais ok/versioned, compense par soft-delete de la nouvelle version, ancienne conservée active', async () => {
    collisionBySiteAndFilename[`${SITE}:facture.pdf`] = {
      status: 'found',
      id: EXISTING_DOC_ID,
      filename: 'facture.pdf',
      document_type: 'autre',
    }
    markDocumentSuperseded.mockRejectedValueOnce(new Error('db down'))

    const fd = pdfFormData('facture.pdf', 'contenu-v2', { version_decision: 'update' })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(false)
    expect(r).not.toHaveProperty('versioned', true)
    // La nouvelle version fantôme est retirée : une seule version "courante" (l'ancienne) reste.
    expect(softDeleteDocument).toHaveBeenCalledWith('new-doc-id')
  })
})

describe('version_decision=update, échec de copyDocumentLinks (invariant A)', () => {
  it('ne bascule jamais l’ancienne version tant que la nouvelle n’a pas hérité de ses liens', async () => {
    collisionBySiteAndFilename[`${SITE}:facture.pdf`] = {
      status: 'found',
      id: EXISTING_DOC_ID,
      filename: 'facture.pdf',
      document_type: 'autre',
    }
    copyDocumentLinks.mockRejectedValueOnce(new Error('db down'))

    const fd = pdfFormData('facture.pdf', 'contenu-v2', { version_decision: 'update' })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(false)
    expect(markDocumentSuperseded).not.toHaveBeenCalled()
    expect(softDeleteDocument).toHaveBeenCalledWith('new-doc-id')
  })
})

describe('collision ambiguë : plusieurs versions actives partagent le même nom (invariant D)', () => {
  it('refuse sans choisir arbitrairement, même avec version_decision=update', async () => {
    collisionBySiteAndFilename[`${SITE}:rapport.pdf`] = {
      status: 'ambiguous',
      ids: ['doc-a', 'doc-b'],
    }

    const fdNoDecision = pdfFormData('rapport.pdf', 'contenu-c')
    const r1 = await uploadDocumentAction(fdNoDecision)
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.ambiguousVersionConflict).toBe(true)

    const fdUpdate = pdfFormData('rapport.pdf', 'contenu-c', { version_decision: 'update' })
    const r2 = await uploadDocumentAction(fdUpdate)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.ambiguousVersionConflict).toBe(true)

    expect(createDocument).not.toHaveBeenCalled()
    expect(markDocumentSuperseded).not.toHaveBeenCalled()
  })
})

describe('version_decision=keep_both', () => {
  it('ne consulte pas la collision et crée un document indépendant, sans supersession', async () => {
    collisionBySiteAndFilename[`${SITE}:facture.pdf`] = {
      status: 'found',
      id: EXISTING_DOC_ID,
      filename: 'facture.pdf',
      document_type: 'autre',
    }

    const fd = pdfFormData('facture.pdf', 'contenu-independant', { version_decision: 'keep_both' })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.versioned).not.toBe(true)
    }
    expect(findFilenameCollisionForSite).not.toHaveBeenCalled()
    expect(createDocument.mock.calls[0][0]).toMatchObject({ supersedes_document_id: null })
    expect(markDocumentSuperseded).not.toHaveBeenCalled()
  })
})

describe('aucune collision (filename différent ou contenu identique)', () => {
  it('importe normalement, jamais de conflit de version ni de supersession', async () => {
    const fd = pdfFormData('autre-nom.pdf', 'contenu-quelconque')
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.versioned).not.toBe(true)
    }
    expect(findFilenameCollisionForSite).toHaveBeenCalledTimes(1)
    expect(findFilenameCollisionInCollection).not.toHaveBeenCalled()
    expect(createDocument.mock.calls[0][0]).toMatchObject({ supersedes_document_id: null })
    expect(markDocumentSuperseded).not.toHaveBeenCalled()
  })
})

describe('replaces_document_id : remplacement explicite (tâche 4)', () => {
  it('ignore la recherche de collision par nom et remplace directement le document validé', async () => {
    validateReplaceCandidateForSite.mockResolvedValueOnce({
      status: 'ok',
      id: EXISTING_DOC_ID,
      filename: 'ancien-nom.pdf',
      content_hash: 'irrelevant',
    })

    const fd = pdfFormData('nouveau-nom-different.pdf', 'contenu-v2', {
      replaces_document_id: EXISTING_DOC_ID,
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.versioned).toBe(true)
    expect(validateReplaceCandidateForSite).toHaveBeenCalledWith(EXISTING_DOC_ID, ORG, SITE)
    expect(findFilenameCollisionForSite).not.toHaveBeenCalled()
    expect(createDocument.mock.calls[0][0]).toMatchObject({ supersedes_document_id: EXISTING_DOC_ID })
    expect(markDocumentSuperseded).toHaveBeenCalledWith(EXISTING_DOC_ID)
  })

  it('refuse si la validation du document désigné échoue, sans aucun effet de bord', async () => {
    validateReplaceCandidateForSite.mockResolvedValueOnce({ status: 'not_linked_to_site' })

    const fd = pdfFormData('nouveau-nom.pdf', 'contenu-v2', {
      replaces_document_id: EXISTING_DOC_ID,
    })
    const r = await uploadDocumentAction(fd)

    expect(r.ok).toBe(false)
    expect(storageUpload).not.toHaveBeenCalled()
    expect(createDocument).not.toHaveBeenCalled()
  })
})
