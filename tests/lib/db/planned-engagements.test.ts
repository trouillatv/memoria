import { beforeEach, describe, expect, it, vi } from 'vitest'

// Revue ChatGPT 2026-09-25 sur P0-3 : le typecheck ne prouve pas que la requête
// utilise réellement .eq('site_id', siteId) et .in('status', ['curated','active']) —
// il prouve seulement que les APPELS ont la bonne FORME. Le mock ci-dessous
// enregistre chaque filtre réellement invoqué par table (même pattern que
// tests/lib/tender-engagement-provenance.test.ts), pour que les tests assertent
// sur les VALEURS passées, pas seulement sur le mapping/agrégation métier.

type QueryRecord = {
  table: string
  select: string
  filters: Array<{ method: string; args: unknown[] }>
}

let tableData: Record<string, unknown[]> = {}
let tableError: Record<string, Error | null> = {}
let queryLog: QueryRecord[] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const record: QueryRecord = { table, select: '', filters: [] }
      queryLog.push(record)
      const query = {
        select(value: string) {
          record.select = value
          return query
        },
        eq(column: string, value: unknown) {
          record.filters.push({ method: 'eq', args: [column, value] })
          return query
        },
        in(column: string, values: unknown[]) {
          record.filters.push({ method: 'in', args: [column, values] })
          return query
        },
        order(column: string, options?: Record<string, unknown>) {
          record.filters.push({ method: 'order', args: [column, options] })
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

function findQuery(table: string): QueryRecord {
  const record = queryLog.find((q) => q.table === table)
  if (!record) throw new Error(`Aucune requête enregistrée sur la table ${table}`)
  return record
}

function filterArgs(record: QueryRecord, method: string, column: string): unknown[] | undefined {
  return record.filters.find((f) => f.method === method && f.args[0] === column)?.args
}

beforeEach(() => {
  tableData = {
    engagements: [],
    document_proposal_materialization: [],
    document_extraction_proposal: [],
    documents: [],
  }
  tableError = {}
  queryLog = []
})

describe('listPlannedEngagementsForSite — filtres réellement exécutés', () => {
  it('interroge engagements avec site_id = siteId ET status IN (curated, active)', async () => {
    tableData.engagements = [engagementRow()]
    tableData.document_extraction_proposal = []
    await listPlannedEngagementsForSite('site-42')

    const record = findQuery('engagements')
    expect(filterArgs(record, 'eq', 'site_id')).toEqual(['site_id', 'site-42'])
    expect(filterArgs(record, 'in', 'status')).toEqual(['status', ['curated', 'active']])
  })

  it("n'inclut jamais archived, extracted ou completed dans le filtre status", async () => {
    tableData.engagements = [engagementRow()]
    await listPlannedEngagementsForSite('site-42')

    const record = findQuery('engagements')
    const statusFilter = filterArgs(record, 'in', 'status') as [string, string[]]
    expect(statusFilter[1]).not.toContain('archived')
    expect(statusFilter[1]).not.toContain('extracted')
    expect(statusFilter[1]).not.toContain('completed')
  })

  it("interroge la matérialisation avec target_entity_type='engagement' et les IDs cibles issus du premier lot", async () => {
    tableData.engagements = [
      engagementRow({ id: 'eng-1' }),
      engagementRow({ id: 'eng-2' }),
    ]
    tableData.document_proposal_materialization = [
      { proposal_id: 'prop-1', target_entity_id: 'eng-1', created_at: '2026-09-01T00:00:00Z' },
    ]
    tableData.document_extraction_proposal = [
      { id: 'prop-1', document_id: 'doc-1', source_page: 5, source_excerpt: 'x', source_payload: null },
    ]
    tableData.documents = [{ id: 'doc-1', filename: 'CCTP.pdf' }]

    await listPlannedEngagementsForSite('site-42')

    const record = findQuery('document_proposal_materialization')
    expect(filterArgs(record, 'eq', 'target_entity_type')).toEqual(['target_entity_type', 'engagement'])
    expect(filterArgs(record, 'in', 'target_entity_id')).toEqual(['target_entity_id', ['eng-1', 'eng-2']])
  })

  it('site sans engagement retourne une liste vide et ne requête jamais la matérialisation', async () => {
    await expect(listPlannedEngagementsForSite('site-1')).resolves.toEqual([])
    expect(queryLog.some((q) => q.table === 'document_proposal_materialization')).toBe(false)
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

  it('P0-3.1A — Engagement Porte B manuel (source_document_id null, aucune matérialisation) : provenance sans document', async () => {
    tableData.engagements = [
      engagementRow({ id: 'eng-manual', source_document_id: null, page_number: null, source_excerpt: 'Nettoyage hebdomadaire des vitres' }),
    ]

    const result = await listPlannedEngagementsForSite('site-1')

    expect(result[0].primaryProvenance).toEqual({
      documentId: null,
      documentFilename: null,
      pageNumber: null,
      excerpt: 'Nettoyage hebdomadaire des vitres',
      frequencyRaw: null,
    })
    expect(queryLog.some((q) => q.table === 'document_proposal_materialization')).toBe(true)
  })
})
