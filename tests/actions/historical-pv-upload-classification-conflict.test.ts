import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

// P0-1B1 (Vincent, review FIX_REQUIRED, 2026-09-24) : le chemin PV historique
// web ne vérifiait un doublon que parmi les PV historiques du même chantier,
// aveugle à un document du même contenu déjà classé sous un autre
// document_type (ex. CCTP) dans l'organisation. findHashClassificationConflict()
// doit bloquer l'import AVANT tout effet de bord (ensureSiteCollection peut
// créer une collection) : un import refusé ne doit rien créer.

const SITE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ORG_ID = '33333333-3333-3333-3333-333333333333'
const UPLOAD_ID = 'upload-1'
const STORAGE_PATH = `historical-pv/${SITE_ID}/upload.pdf`

const PDF_CONTENT = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('contenu-deja-cctp')])
const CONTENT_HASH = createHash('sha256').update(PDF_CONTENT).digest('hex')

let classificationConflict: { id: string; document_type: string } | null = null

const getUser = vi.fn()
const getUserRoleById = vi.fn()
const getUploadById = vi.fn()
const markUploadAsFailed = vi.fn(async (..._args: unknown[]) => {})
const markUploadAsConfirmed = vi.fn(async (..._args: unknown[]) => true)
const findHistoricalPvByHashForSite = vi.fn(async (..._args: unknown[]) => null)
const countHistoricalPvsByDateForSite = vi.fn(async (..._args: unknown[]) => 0)
const findHashClassificationConflict = vi.fn(async (..._args: unknown[]) => classificationConflict)
const createDocument = vi.fn(async (..._args: unknown[]) => 'new-doc-id')
const addDocumentLink = vi.fn(async (..._args: unknown[]) => {})
const createDocumentCollection = vi.fn(async (..._args: unknown[]) => 'new-collection-id')
const listDocumentCollections = vi.fn(async (..._args: unknown[]) => [] as { id: string; scope_type: string; scope_id: string }[])
const storageList = vi.fn(async (..._args: unknown[]) => ({
  data: [{ metadata: { size: PDF_CONTENT.byteLength, mimetype: 'application/pdf' } }],
  error: null,
}))
const storageDownload = vi.fn(async (..._args: unknown[]) => ({
  data: { arrayBuffer: async () => PDF_CONTENT.buffer.slice(PDF_CONTENT.byteOffset, PDF_CONTENT.byteOffset + PDF_CONTENT.byteLength) },
  error: null,
}))
const sitesSelect = vi.fn(() => ({
  eq: () => ({
    maybeSingle: async () => ({ data: { organization_id: ORG_ID }, error: null }),
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => getUser() },
  }),
}))
vi.mock('@/lib/db/users', () => ({
  getUserRoleById: (...args: unknown[]) => getUserRoleById(...args),
}))
vi.mock('@/lib/db/historical-pv-uploads', () => ({
  createPendingUpload: vi.fn(),
  markUploadAsConfirmed: (...args: unknown[]) => markUploadAsConfirmed(...args),
  markUploadAsFailed: (...args: unknown[]) => markUploadAsFailed(...args),
  getUploadByStoragePath: vi.fn(),
  getUploadById: (...args: unknown[]) => getUploadById(...args),
}))
vi.mock('@/lib/db/documents', () => ({
  createDocumentCollection: (...args: unknown[]) => createDocumentCollection(...args),
  listDocumentCollections: (...args: unknown[]) => listDocumentCollections(...args),
  createDocument: (...args: unknown[]) => createDocument(...args),
  addDocumentLink: (...args: unknown[]) => addDocumentLink(...args),
  findHistoricalPvByHashForSite: (...args: unknown[]) => findHistoricalPvByHashForSite(...args),
  countHistoricalPvsByDateForSite: (...args: unknown[]) => countHistoricalPvsByDateForSite(...args),
  findHashClassificationConflict: (...args: unknown[]) => findHashClassificationConflict(...args),
}))
vi.mock('@/lib/documents/labels', () => ({
  documentTypeLabel: (type: string) => (type === 'cctp' ? 'CCTP' : type),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        list: (...args: unknown[]) => storageList(...args),
        download: (...args: unknown[]) => storageDownload(...args),
      }),
    },
    from: (table: string) => {
      if (table === 'sites') return { select: sitesSelect }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: () => null })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: vi.fn() }
})

const { confirmHistoricalPvImport } = await import('@/app/(dashboard)/sites/[id]/historical-pv-upload-actions')

beforeEach(() => {
  vi.clearAllMocks()
  classificationConflict = null
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  getUserRoleById.mockResolvedValue('manager')
  getUploadById.mockResolvedValue({
    id: UPLOAD_ID,
    siteId: SITE_ID,
    status: 'uploaded',
    documentId: null,
    fileHashSha256: undefined,
    originalFilename: 'pv-historique.pdf',
    errorMessage: null,
  })
  findHistoricalPvByHashForSite.mockResolvedValue(null)
  storageList.mockResolvedValue({
    data: [{ metadata: { size: PDF_CONTENT.byteLength, mimetype: 'application/pdf' } }],
    error: null,
  })
  storageDownload.mockResolvedValue({
    data: {
      arrayBuffer: async () => PDF_CONTENT.buffer.slice(PDF_CONTENT.byteOffset, PDF_CONTENT.byteOffset + PDF_CONTENT.byteLength),
    },
    error: null,
  })
})

describe('confirmHistoricalPvImport — conflit de classification (P0-1B1)', () => {
  it('même hash déjà présent comme cctp dans l’organisation → refus, aucun document créé, aucune collection créée', async () => {
    classificationConflict = { id: 'existing-cctp-doc', document_type: 'cctp' }

    const result = await confirmHistoricalPvImport({
      uploadId: UPLOAD_ID,
      siteId: SITE_ID,
      storagePath: STORAGE_PATH,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/CCTP/)
      expect(result.canRetry).toBe(false)
    }
    expect(createDocument).not.toHaveBeenCalled()
    expect(addDocumentLink).not.toHaveBeenCalled()
    expect(createDocumentCollection).not.toHaveBeenCalled()
    expect(markUploadAsConfirmed).not.toHaveBeenCalled()
  })

  it('aucun conflit → import normal, document créé', async () => {
    classificationConflict = null

    const result = await confirmHistoricalPvImport({
      uploadId: UPLOAD_ID,
      siteId: SITE_ID,
      storagePath: STORAGE_PATH,
    })

    expect(result.ok).toBe(true)
    expect(createDocument).toHaveBeenCalledTimes(1)
    expect(findHashClassificationConflict).toHaveBeenCalledWith(CONTENT_HASH, ORG_ID, 'historical_visit_report')
  })
})
