import { beforeEach, describe, expect, it, vi } from 'vitest'

// P0-1B2 revue FIX_REQUIRED (Vincent 2026-09-24, correction 1) : « une chaîne
// de versions ne peut relier que des documents métier compatibles ». Ces
// tests prouvent le comportement RÉEL de findFilenameCollisionForSite et
// validateReplaceCandidateForSite (contrairement à
// tests/actions/document-upload-versioning.test.ts, qui mocke entièrement
// lib/db/documents et ne peut donc prouver que le câblage côté action).

const SITE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ORG = '33333333-3333-3333-3333-333333333333'

type FakeDocument = {
  id: string
  filename: string
  document_type: string
  content_hash: string
  status: string
  deleted_at: string | null
}

type FakeLinkRow = {
  document_id: string
  target_type: string
  target_id: string
  documents: FakeDocument
}

type FakeDocumentRow = {
  id: string
  filename: string
  content_hash: string
  status: string
  organization_id: string
  document_type: string
  deleted_at: string | null
  collection_id?: string
}

let documentLinksRows: FakeLinkRow[] = []
let documentsRows: FakeDocumentRow[] = []

function documentLinksChain() {
  let rows = documentLinksRows
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[col] === val)
      return chain
    },
    filter: (col: string, op: 'eq' | 'neq', val: unknown) => {
      const field = col.split('.')[1]
      rows = rows.filter((r) => {
        const actual = (r.documents as unknown as Record<string, unknown>)[field]
        return op === 'eq' ? actual === val : actual !== val
      })
      return chain
    },
    is: (col: string, val: unknown) => {
      const field = col.split('.')[1]
      rows = rows.filter((r) => (r.documents as unknown as Record<string, unknown>)[field] === val)
      return chain
    },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: { data: FakeLinkRow[]; error: null }) => void) => resolve({ data: rows, error: null }),
  }
  return chain
}

function documentsTableChain() {
  let rows = documentsRows
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[col] === val)
      return chain
    },
    neq: (col: string, val: unknown) => {
      rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[col] !== val)
      return chain
    },
    is: (col: string, val: unknown) => {
      rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[col] === val)
      return chain
    },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: { data: FakeDocumentRow[]; error: null }) => void) => resolve({ data: rows, error: null }),
  }
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'document_links') return documentLinksChain()
      if (table === 'documents') return documentsTableChain()
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

const { findFilenameCollisionForSite, validateReplaceCandidateForSite, findFilenameCollisionInCollection } =
  await import('@/lib/db/documents')

beforeEach(() => {
  documentLinksRows = []
  documentsRows = []
})

describe('findFilenameCollisionForSite — type gating', () => {
  it('CCTP -> CCTP : détecte la collision (même document_type)', async () => {
    documentLinksRows = [
      {
        document_id: 'doc-cctp-1',
        target_type: 'site',
        target_id: SITE,
        documents: { id: 'doc-cctp-1', filename: 'cctp.pdf', document_type: 'cctp', content_hash: 'old-hash', status: 'active', deleted_at: null },
      },
    ]

    const result = await findFilenameCollisionForSite('cctp.pdf', SITE, 'new-hash', 'cctp')
    expect(result).toMatchObject({ status: 'found', id: 'doc-cctp-1' })
  })

  it('CCTP upload + PV historique même filename : aucune collision détectée (types incompatibles)', async () => {
    documentLinksRows = [
      {
        document_id: 'doc-pv-1',
        target_type: 'site',
        target_id: SITE,
        documents: {
          id: 'doc-pv-1',
          filename: 'rapport.pdf',
          document_type: 'historical_visit_report',
          content_hash: 'old-hash',
          status: 'active',
          deleted_at: null,
        },
      },
    ]

    const result = await findFilenameCollisionForSite('rapport.pdf', SITE, 'new-hash', 'cctp')
    expect(result).toEqual({ status: 'none' })
  })
})

describe('validateReplaceCandidateForSite — type gating', () => {
  it('Contrat -> CCTP : refuse (nature différente)', async () => {
    documentsRows = [
      {
        id: 'doc-contrat-1',
        filename: 'contrat.pdf',
        content_hash: 'h',
        status: 'active',
        organization_id: ORG,
        document_type: 'contrat',
        deleted_at: null,
      },
    ]

    const result = await validateReplaceCandidateForSite('doc-contrat-1', ORG, SITE, 'cctp')
    expect(result).toEqual({ status: 'wrong_document_type' })
  })

  it('refuse un PV historique comme candidat de remplacement, quel que soit expectedDocumentType', async () => {
    documentsRows = [
      {
        id: 'doc-pv-1',
        filename: 'rapport.pdf',
        content_hash: 'h',
        status: 'active',
        organization_id: ORG,
        document_type: 'historical_visit_report',
        deleted_at: null,
      },
    ]

    const result = await validateReplaceCandidateForSite('doc-pv-1', ORG, SITE, 'historical_visit_report')
    expect(result).toEqual({ status: 'wrong_document_type' })
  })

  it('CCTP -> CCTP : accepte quand le document est rattaché au chantier', async () => {
    documentsRows = [
      {
        id: 'doc-cctp-1',
        filename: 'cctp.pdf',
        content_hash: 'h',
        status: 'active',
        organization_id: ORG,
        document_type: 'cctp',
        deleted_at: null,
      },
    ]
    documentLinksRows = [
      {
        document_id: 'doc-cctp-1',
        target_type: 'site',
        target_id: SITE,
        documents: { id: 'doc-cctp-1', filename: 'cctp.pdf', document_type: 'cctp', content_hash: 'h', status: 'active', deleted_at: null },
      },
    ]

    const result = await validateReplaceCandidateForSite('doc-cctp-1', ORG, SITE, 'cctp')
    expect(result).toMatchObject({ status: 'ok', id: 'doc-cctp-1' })
  })
})

// P0-1B2 revue FIX_REQUIRED (Vincent 2026-09-24, 2e revue) : le fallback
// collection (upload sans cible chantier) doit respecter la même doctrine de
// type-gating que findFilenameCollisionForSite.
describe('findFilenameCollisionInCollection — type gating', () => {
  const COLLECTION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

  it('collection identique + filename identique + CCTP existant + Contrat entrant : aucune collision (natures différentes)', async () => {
    documentsRows = [
      {
        id: 'doc-cctp-1',
        filename: 'doc.pdf',
        content_hash: 'old-hash',
        status: 'active',
        organization_id: ORG,
        document_type: 'cctp',
        deleted_at: null,
        collection_id: COLLECTION,
      },
    ]

    const result = await findFilenameCollisionInCollection('doc.pdf', COLLECTION, 'new-hash', 'contrat')
    expect(result).toEqual({ status: 'none' })
  })

  it('CCTP -> CCTP : reste détecté (même nature)', async () => {
    documentsRows = [
      {
        id: 'doc-cctp-1',
        filename: 'doc.pdf',
        content_hash: 'old-hash',
        status: 'active',
        organization_id: ORG,
        document_type: 'cctp',
        deleted_at: null,
        collection_id: COLLECTION,
      },
    ]

    const result = await findFilenameCollisionInCollection('doc.pdf', COLLECTION, 'new-hash', 'cctp')
    expect(result).toMatchObject({ status: 'found', id: 'doc-cctp-1' })
  })

  it('plusieurs CCTP actifs de même nom restent ambiguous (le filtre document_type ne cache jamais une ambiguïté réelle)', async () => {
    documentsRows = [
      {
        id: 'doc-cctp-1',
        filename: 'doc.pdf',
        content_hash: 'hash-1',
        status: 'active',
        organization_id: ORG,
        document_type: 'cctp',
        deleted_at: null,
        collection_id: COLLECTION,
      },
      {
        id: 'doc-cctp-2',
        filename: 'doc.pdf',
        content_hash: 'hash-2',
        status: 'active',
        organization_id: ORG,
        document_type: 'cctp',
        deleted_at: null,
        collection_id: COLLECTION,
      },
    ]

    const result = await findFilenameCollisionInCollection('doc.pdf', COLLECTION, 'new-hash', 'cctp')
    expect(result).toMatchObject({ status: 'ambiguous' })
  })
})
