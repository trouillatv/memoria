import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

// P0-1B1 (Vincent, review FIX_REQUIRED, 2026-09-24) : le chemin batch d'import
// PV historique refuse l'enregistrement quand le même contenu existe déjà
// sous un autre document_type (ex. CCTP) dans l'organisation, plutôt que de
// le fusionner ou le reclassifier silencieusement.

const SITE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ORG_ID = '33333333-3333-3333-3333-333333333333'
const FILE_PATH = '/tmp/pv-historique-deja-cctp.pdf'
const FILE_CONTENT = Buffer.from('contenu-deja-cctp-batch')
const CONTENT_HASH = createHash('sha256').update(FILE_CONTENT).digest('hex')

let classificationConflict: { id: string; document_type: string } | null = null

const findHistoricalPvByHashForSite = vi.fn(async (..._args: unknown[]) => null)
const findHashClassificationConflict = vi.fn(async (..._args: unknown[]) => classificationConflict)
const addDocumentLink = vi.fn(async (..._args: unknown[]) => {})
const storageUpload = vi.fn(async (..._args: unknown[]) => ({ error: null }))
const documentsInsert = vi.fn(() => ({
  select: () => ({
    single: async () => ({ data: { id: 'new-doc-id' }, error: null }),
  }),
}))
const sitesSelect = vi.fn(() => ({
  eq: () => ({
    maybeSingle: async () => ({ data: { organization_id: ORG_ID }, error: null }),
  }),
}))
const collectionsSelect = vi.fn(() => ({
  eq: () => ({
    eq: () => ({
      is: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
  }),
}))
const collectionsInsert = vi.fn(() => ({
  select: () => ({
    single: async () => ({ data: { id: 'new-collection-id' }, error: null }),
  }),
}))

vi.mock('node:fs/promises', () => {
  const readFile = vi.fn(async () => FILE_CONTENT)
  return { readFile, default: { readFile } }
})
vi.mock('@/lib/db/documents', () => ({
  findHistoricalPvByHashForSite: (...args: unknown[]) => findHistoricalPvByHashForSite(...args),
  findHashClassificationConflict: (...args: unknown[]) => findHashClassificationConflict(...args),
  addDocumentLink: (...args: unknown[]) => addDocumentLink(...args),
}))
vi.mock('@/lib/documents/labels', () => ({
  documentTypeLabel: (type: string) => (type === 'cctp' ? 'CCTP' : type),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({ upload: (...args: unknown[]) => storageUpload(...args) }),
    },
    from: (table: string) => {
      if (table === 'sites') return { select: sitesSelect }
      if (table === 'documents') return { insert: documentsInsert }
      if (table === 'document_collections') return { select: collectionsSelect, insert: collectionsInsert }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

const { registerMissingHistoricalDocument } = await import('@/lib/batch/historical-import-registration')

beforeEach(() => {
  vi.clearAllMocks()
  classificationConflict = null
  findHistoricalPvByHashForSite.mockResolvedValue(null)
})

describe('registerMissingHistoricalDocument — conflit de classification (P0-1B1)', () => {
  it('même hash déjà présent comme cctp → refus, aucun upload ni création documentaire', async () => {
    classificationConflict = { id: 'existing-cctp-doc', document_type: 'cctp' }

    await expect(
      registerMissingHistoricalDocument({
        filePath: FILE_PATH,
        siteId: SITE_ID,
        createdBy: 'user-1',
        effectiveDate: null,
      }),
    ).rejects.toThrow(/CCTP/)

    expect(storageUpload).not.toHaveBeenCalled()
    expect(documentsInsert).not.toHaveBeenCalled()
    expect(addDocumentLink).not.toHaveBeenCalled()
  })

  it('aucun conflit → enregistrement normal', async () => {
    classificationConflict = null

    const result = await registerMissingHistoricalDocument({
      filePath: FILE_PATH,
      siteId: SITE_ID,
      createdBy: 'user-1',
      effectiveDate: null,
    })

    expect(result).toEqual({ documentId: 'new-doc-id', status: 'created' })
    expect(findHashClassificationConflict).toHaveBeenCalledWith(CONTENT_HASH, ORG_ID, 'historical_visit_report')
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(documentsInsert).toHaveBeenCalledTimes(1)
  })
})
