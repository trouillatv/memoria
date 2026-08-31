// P0-temporel — readEvents ne doit JAMAIS conditionner la présence d'un PV
// historique importé (origin='import') à started_at/ended_at (souvent NULL).
// Seule documents.effective_date décide de sa position ; started_at/ended_at
// restent la seule doctrine des visites terrain (inchangée).
//
// Cas couverts (mandat Vincent) :
//  1. BELLA : les 3 PV apparaissent, quel que soit l'ordre de traitement.
//  2. Import ended_at=NULL reste visible.
//  3. Une visite terrain n'est jamais reclassée par la logique import.
//  4. L'`at` d'un import ne retombe jamais sur sa date d'ingestion quand une
//     effective_date existe.

import { describe, it, expect, beforeEach, vi } from 'vitest'

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
        neq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] !== val); return api },
        is: (col: string, val: unknown) => { rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val)); return api },
        not: (col: string, op: string, val: unknown) => {
          if (op === 'is' && val === null) rows = rows.filter((r) => r[col] != null)
          return api
        },
        gte: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] != null && String(r[col]) >= String(val)); return api },
        lte: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] != null && String(r[col]) <= String(val)); return api },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return api },
        order: () => api,
        limit: (n: number) => { rows = rows.slice(0, n); return api },
        maybeSingle: async () => ({ data: rows[0] ?? null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
      }
      return api
    },
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeFakeDb(),
}))

const { readEvents } = await import('@/lib/knowledge/repository')

const SITE = 'site-bella'
const FROM = '2020-01-01T00:00:00.000Z'
const TO = '2026-12-31T23:59:59.000Z'

beforeEach(() => {
  tables = {
    site_reports: [],
    documents: [],
    site_knowledge_proposals: [],
  }
})

describe('readEvents — P0-temporel (imports positionnés par effective_date)', () => {
  it('BELLA : les 3 PV importés apparaissent, quel que soit l’ordre de traitement (aucun ne dépend de ended_at)', async () => {
    // Ordre de TRAITEMENT volontairement inversé par rapport à l'ordre métier —
    // c'est exactement le scénario réel BELLA (processed 27/08, 27/08, 29/08 ;
    // effective_date 19/07/2024, 05/08/2025, 22/07/2026).
    tables.site_reports = [
      { id: 'r-2026', site_id: SITE, started_at: null, ended_at: null, created_at: '2026-08-29T21:29:00Z', origin: 'import', source_document_id: 'doc-2026', deleted_at: null },
      { id: 'r-2024', site_id: SITE, started_at: null, ended_at: null, created_at: '2026-08-27T01:17:00Z', origin: 'import', source_document_id: 'doc-2024', deleted_at: null },
      { id: 'r-2025', site_id: SITE, started_at: null, ended_at: null, created_at: '2026-08-27T01:34:00Z', origin: 'import', source_document_id: 'doc-2025', deleted_at: null },
    ]
    tables.documents = [
      { id: 'doc-2024', effective_date: '2024-07-19' },
      { id: 'doc-2025', effective_date: '2025-08-05' },
      { id: 'doc-2026', effective_date: '2026-07-22' },
    ]

    const rows = await readEvents(FROM, TO, null, SITE)
    const visits = rows.filter((r) => r.kind === 'visit_ended')
    expect(visits).toHaveLength(3)
    expect(visits.every((r) => r.is_import)).toBe(true)
    const byReport = new Map(visits.map((r) => [r.report_id, r.at]))
    expect(byReport.get('r-2024')).toBe('2024-07-19')
    expect(byReport.get('r-2025')).toBe('2025-08-05')
    expect(byReport.get('r-2026')).toBe('2026-07-22')
  })

  it('un import avec ended_at=NULL reste visible (ne dépend jamais de started_at/ended_at)', async () => {
    tables.site_reports = [
      { id: 'r-1', site_id: SITE, started_at: null, ended_at: null, created_at: '2026-08-27T01:17:00Z', origin: 'import', source_document_id: 'doc-1', deleted_at: null },
    ]
    tables.documents = [{ id: 'doc-1', effective_date: '2024-07-19' }]

    const rows = await readEvents(FROM, TO, null, SITE)
    expect(rows.filter((r) => r.kind === 'visit_ended')).toHaveLength(1)
  })

  it('une visite terrain garde sa doctrine native (ended_at) et n’est jamais marquée is_import', async () => {
    tables.site_reports = [
      { id: 'r-terrain', site_id: SITE, started_at: '2026-08-10T07:00:00Z', ended_at: '2026-08-10T07:40:00Z', created_at: '2026-08-10T06:00:00Z', origin: 'planned', source_document_id: null, deleted_at: null, debrief_analysis: null },
    ]
    const rows = await readEvents(FROM, TO, null, SITE)
    const visits = rows.filter((r) => r.kind === 'visit_ended')
    expect(visits).toHaveLength(1)
    expect(visits[0].at).toBe('2026-08-10T07:40:00Z')
    expect(visits[0].is_import).toBeUndefined()
  })

  it('la date d’un import n’est JAMAIS sa date d’ingestion quand une effective_date existe', async () => {
    tables.site_reports = [
      { id: 'r-1', site_id: SITE, started_at: null, ended_at: null, created_at: '2026-08-30T00:00:00Z', origin: 'import', source_document_id: 'doc-1', deleted_at: null },
    ]
    tables.documents = [{ id: 'doc-1', effective_date: '2024-07-19' }]
    const rows = await readEvents(FROM, TO, null, SITE)
    const visit = rows.find((r) => r.kind === 'visit_ended')!
    expect(visit.at).toBe('2024-07-19')
    expect(visit.at).not.toBe('2026-08-30T00:00:00Z')
  })

  it('un import sans effective_date connue reste présent (jamais exclu faute de date prouvée)', async () => {
    tables.site_reports = [
      { id: 'r-1', site_id: SITE, started_at: null, ended_at: null, created_at: '2026-08-30T00:00:00Z', origin: 'import', source_document_id: null, deleted_at: null },
    ]
    const rows = await readEvents(FROM, TO, null, SITE)
    expect(rows.filter((r) => r.kind === 'visit_ended')).toHaveLength(1)
  })
})
