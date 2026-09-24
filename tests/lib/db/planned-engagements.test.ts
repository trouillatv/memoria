import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock table-routé : chaque table renvoie ses propres lignes, quel que soit
// l'enchaînement .select/.eq/.in/.order utilisé par listPlannedEngagementsForSite.
// Pas de vérification des filtres ici (déjà couvert par le typecheck des
// signatures Supabase) — seul le mapping/agrégation métier est sous test.

let tableData: Record<string, unknown[]> = {}
let tableError: Record<string, Error | null> = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const query = {
        select() {
          return query
        },
        eq() {
          return query
        },
        in() {
          return query
        },
        order() {
          return query
        },
        then(resolve: (value: { data: unknown[]; error: Error | null }) => unknown) {
          return Promise.resolve(
            resolve({ data: tableData[table] ?? [], error: tableError[table] ?? null }),
          )
        },
      }
      return query
    },
  }),
}))

import { listPlannedEngagementsForSite } from '@/lib/db/engagements'

function engagementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eng-1',
    short_label: 'Nettoyage mensuel des filtres',
    category: 'frequency',
    kind: 'obligation',
    measurable: false,
    status: 'curated',
    source_document_id: 'doc-fallback',
    page_number: 3,
    source_excerpt: 'extrait de secours',
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  tableData = {
    engagements: [],
    document_proposal_materialization: [],
    document_extraction_proposal: [],
    documents: [],
  }
  tableError = {}
})

describe('listPlannedEngagementsForSite', () => {
  it('site sans engagement retourne une liste vide', async () => {
    await expect(listPlannedEngagementsForSite('site-1')).resolves.toEqual([])
  })

  it('mappe un engagement curated avec provenance issue de la matérialisation (frequency_raw inclus)', async () => {
    tableData.engagements = [engagementRow()]
    tableData.document_proposal_materialization = [
      { proposal_id: 'prop-1', target_entity_id: 'eng-1', created_at: '2026-09-01T00:00:00Z' },
    ]
    tableData.document_extraction_proposal = [
      {
        id: 'prop-1',
        document_id: 'doc-1',
        source_page: 5,
        source_excerpt: 'Nettoyer les filtres tous les mois',
        source_payload: { frequency_raw: 'Mensuel' },
      },
    ]
    tableData.documents = [{ id: 'doc-1', filename: 'CCTP.pdf' }]

    const result = await listPlannedEngagementsForSite('site-1')

    expect(result).toEqual([
      {
        id: 'eng-1',
        shortLabel: 'Nettoyage mensuel des filtres',
        category: 'frequency',
        kind: 'obligation',
        measurable: false,
        status: 'curated',
        createdAt: '2026-09-01T00:00:00Z',
        primaryProvenance: {
          documentId: 'doc-1',
          documentFilename: 'CCTP.pdf',
          pageNumber: 5,
          excerpt: 'Nettoyer les filtres tous les mois',
          frequencyRaw: 'Mensuel',
        },
        additionalProvenance: [],
      },
    ])
  })

  it('agrège plusieurs matérialisations sur le même engagement en additionalProvenance', async () => {
    tableData.engagements = [engagementRow({ status: 'active' })]
    tableData.document_proposal_materialization = [
      { proposal_id: 'prop-1', target_entity_id: 'eng-1', created_at: '2026-09-01T00:00:00Z' },
      { proposal_id: 'prop-2', target_entity_id: 'eng-1', created_at: '2026-09-02T00:00:00Z' },
    ]
    tableData.document_extraction_proposal = [
      { id: 'prop-1', document_id: 'doc-1', source_page: 5, source_excerpt: 'premier extrait', source_payload: { frequency_raw: 'Mensuel' } },
      { id: 'prop-2', document_id: 'doc-2', source_page: 9, source_excerpt: 'second extrait', source_payload: null },
    ]
    tableData.documents = [
      { id: 'doc-1', filename: 'CCTP.pdf' },
      { id: 'doc-2', filename: 'Avenant.pdf' },
    ]

    const result = await listPlannedEngagementsForSite('site-1')

    expect(result[0].status).toBe('active')
    expect(result[0].primaryProvenance.documentFilename).toBe('CCTP.pdf')
    expect(result[0].additionalProvenance).toEqual([
      {
        documentId: 'doc-2',
        documentFilename: 'Avenant.pdf',
        pageNumber: 9,
        excerpt: 'second extrait',
        frequencyRaw: null,
      },
    ])
  })

  it('sans lineage de matérialisation, retombe sur les champs copiés sur engagements', async () => {
    tableData.engagements = [engagementRow({ id: 'eng-2' })]
    tableData.documents = [{ id: 'doc-fallback', filename: 'CCAP.pdf' }]

    const result = await listPlannedEngagementsForSite('site-1')

    expect(result).toEqual([
      {
        id: 'eng-2',
        shortLabel: 'Nettoyage mensuel des filtres',
        category: 'frequency',
        kind: 'obligation',
        measurable: false,
        status: 'curated',
        createdAt: '2026-09-01T00:00:00Z',
        primaryProvenance: {
          documentId: 'doc-fallback',
          documentFilename: 'CCAP.pdf',
          pageNumber: 3,
          excerpt: 'extrait de secours',
          frequencyRaw: null,
        },
        additionalProvenance: [],
      },
    ])
  })

  it('propage les erreurs Supabase sur la requête engagements', async () => {
    tableError.engagements = new Error('database unavailable')

    await expect(listPlannedEngagementsForSite('site-1')).rejects.toThrow('database unavailable')
  })
})
