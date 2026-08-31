// P0-temporel — une proposition d'acteur issue d'un PV historique importé doit
// afficher la date DOCUMENTAIRE (documents.effective_date), jamais started_at ni
// created_at (dates techniques d'ingestion). C'est reportDate qui est rendu à
// l'écran (ActorProposalsQueue.tsx via formatDate(source.reportDate)).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type Row = Record<string, unknown>
let tables: Record<string, Row[]> = {}

function makeFakeDb() {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])]
      const api: Record<string, unknown> = {
        select: () => api,
        eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return api },
        is: (col: string, val: unknown) => { rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val)); return api },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return api },
        order: () => api,
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
      }
      return api
    },
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeFakeDb(),
}))

const { getUnconfirmedActorProposals } = await import('@/lib/db/actor-proposals')

beforeEach(() => {
  tables = {
    site_knowledge_proposals: [],
    sites: [{ id: 'site-bella', name: 'BELLA' }],
    site_reports: [],
    documents: [],
    visit_capture: [],
    company_contacts: [],
    companies: [],
  }
})

describe('getUnconfirmedActorProposals — P0-temporel (reportDate d’un import = effective_date)', () => {
  it('une proposition issue d’un PV importé affiche l’effective_date, pas started_at/created_at', async () => {
    tables.site_knowledge_proposals = [
      { id: 'p-1', title: 'Jean Dupont', site_id: 'site-bella', report_id: 'r-import', source_capture_ids: [], created_at: '2026-08-27T01:17:00Z', organization_id: 'org-1', kind: 'stakeholder', status: 'proposed' },
    ]
    tables.site_reports = [
      { id: 'r-import', started_at: null, created_at: '2026-08-27T01:17:00Z', title: null, origin: 'import', source_document_id: 'doc-1' },
    ]
    tables.documents = [{ id: 'doc-1', effective_date: '2024-07-19' }]

    const proposals = await getUnconfirmedActorProposals(['org-1'])
    expect(proposals).toHaveLength(1)
    expect(proposals[0].source.reportDate).toBe('2024-07-19')
    expect(proposals[0].source.reportDate).not.toBe('2026-08-27T01:17:00Z')
  })

  it('une proposition issue d’une visite terrain garde started_at (doctrine inchangée)', async () => {
    tables.site_knowledge_proposals = [
      { id: 'p-2', title: 'Marc Petit', site_id: 'site-bella', report_id: 'r-terrain', source_capture_ids: [], created_at: '2026-08-10T06:00:00Z', organization_id: 'org-1', kind: 'stakeholder', status: 'proposed' },
    ]
    tables.site_reports = [
      { id: 'r-terrain', started_at: '2026-08-10T07:00:00Z', created_at: '2026-08-10T06:00:00Z', title: null, origin: 'planned', source_document_id: null },
    ]

    const proposals = await getUnconfirmedActorProposals(['org-1'])
    expect(proposals[0].source.reportDate).toBe('2026-08-10T07:00:00Z')
  })

  it('un import sans effective_date connue affiche reportDate=null (jamais une date fabriquée)', async () => {
    tables.site_knowledge_proposals = [
      { id: 'p-3', title: 'Ginger', site_id: 'site-bella', report_id: 'r-import-2', source_capture_ids: [], created_at: '2026-08-27T01:17:00Z', organization_id: 'org-1', kind: 'stakeholder', status: 'proposed' },
    ]
    tables.site_reports = [
      { id: 'r-import-2', started_at: null, created_at: '2026-08-27T01:17:00Z', title: null, origin: 'import', source_document_id: null },
    ]

    const proposals = await getUnconfirmedActorProposals(['org-1'])
    expect(proposals[0].source.reportDate).toBeNull()
  })
})
