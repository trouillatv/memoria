import { beforeEach, describe, expect, it, vi } from 'vitest'

// P0-1B2 revue FIX_REQUIRED (Vincent 2026-09-24, tâche 2) : « superseded » doit
// devenir historique pour de vrai. copyDocumentLinks reporte TOUS les liens de
// V1 vers V2 SANS retirer les liens de V1 (cf. document-links-copy.test.ts) —
// donc pour une même cible, document_links peut pointer à la fois vers V1 et
// V2. Les lecteurs "courants" (listLinkedDocumentsForTargets,
// loadActiveDocumentMetadataByIds) doivent filtrer `status != 'superseded'`
// pour ne jamais faire apparaître les deux versions à la fois — mais un accès
// direct par id (getDocument) doit continuer à fonctionner pour V1.

const V1 = 'doc-v1'
const V2 = 'doc-v2'
const TARGET = 'obligation-1'

type Row = Record<string, unknown>

function tableQuery(rows: Row[]) {
  let filtered = rows
  const api = {
    select: () => api,
    eq: (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val)
      return api
    },
    in: (col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => vals.includes(r[col]))
      return api
    },
    is: (col: string, val: unknown) => {
      filtered = filtered.filter((r) => (val === null ? r[col] == null : r[col] === val))
      return api
    },
    neq: (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] !== val)
      return api
    },
    maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: filtered, error: null }),
  }
  return api
}

let documentLinksRows: Row[] = []
let documentsRows: Row[] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'document_links') return tableQuery(documentLinksRows)
      if (table === 'documents') return tableQuery(documentsRows)
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

const { listLinkedDocumentsForTargets, loadActiveDocumentMetadataByIds, getDocument } = await import(
  '@/lib/db/documents'
)

beforeEach(() => {
  vi.clearAllMocks()
  documentLinksRows = [
    { id: 'link-v1', document_id: V1, target_id: TARGET, target_type: 'contract', reference_label: null },
    { id: 'link-v2', document_id: V2, target_id: TARGET, target_type: 'contract', reference_label: null },
  ]
  documentsRows = [
    { id: V1, filename: 'cctp.pdf', document_type: 'cctp', status: 'superseded', deleted_at: null, effective_date: null },
    { id: V2, filename: 'cctp.pdf', document_type: 'cctp', status: 'active', deleted_at: null, effective_date: null },
  ]
})

describe('listLinkedDocumentsForTargets', () => {
  it('exclut V1 (superseded) et ne retourne que V2 pour la cible liée aux deux', async () => {
    const result = await listLinkedDocumentsForTargets('contract', [TARGET])
    const docs = result.get(TARGET) ?? []
    expect(docs).toHaveLength(1)
    expect(docs[0].documentId).toBe(V2)
  })
})

describe('loadActiveDocumentMetadataByIds', () => {
  it('exclut V1 (superseded) de la Map même si son id est explicitement demandé', async () => {
    const admin = { from: (t: string) => (t === 'documents' ? tableQuery(documentsRows) : tableQuery([])) } as unknown as Parameters<typeof loadActiveDocumentMetadataByIds>[0]
    const map = await loadActiveDocumentMetadataByIds(admin, [V1, V2])
    expect(map.has(V1)).toBe(false)
    expect(map.has(V2)).toBe(true)
  })
})

describe('getDocument', () => {
  it('reste consultable directement par id pour une version superseded (historique conservé)', async () => {
    const doc = await getDocument(V1)
    expect(doc).not.toBeNull()
    expect(doc?.id).toBe(V1)
  })
})
