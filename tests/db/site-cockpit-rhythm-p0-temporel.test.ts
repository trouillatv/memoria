// P0-temporel — le carnet de bord (getSiteRecentRhythm) ne doit jamais positionner
// un PV historique importé à sa date d'INGESTION (site_reports.created_at) : seule
// documents.effective_date (via readImportDocumentDates) fait foi. Un PV traité
// aujourd'hui mais daté juillet 2024 doit apparaître le 19/07/2024, pas aujourd'hui.

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
        gte: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] != null && String(r[col]) >= String(val)); return api },
        lte: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] != null && String(r[col]) <= String(val)); return api },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return api },
        order: () => api,
        limit: (n: number) => { rows = rows.slice(0, n); return api },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
      }
      return api
    },
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeFakeDb(),
}))

const { getSiteRecentRhythm } = await import('@/lib/db/site-cockpit')

const SITE = 'site-bella'

beforeEach(() => {
  tables = {
    missions: [],
    interventions: [],
    teams: [],
    team_members: [],
    users: [],
    site_actions: [],
    site_reports: [],
    documents: [],
  }
})

describe('getSiteRecentRhythm — P0-temporel (import positionné par effective_date, jamais created_at)', () => {
  it('un PV importé aujourd’hui mais daté juillet 2024 est absent du carnet 14 j (hors fenêtre) — pas de fabrication sur aujourd’hui', async () => {
    const today = new Date().toISOString()
    tables.site_reports = [
      { id: 'r-1', site_id: SITE, created_at: today, origin: 'import', source_document_id: 'doc-1' },
    ]
    tables.documents = [{ id: 'doc-1', effective_date: '2024-07-19' }]

    const days = await getSiteRecentRhythm(SITE, 14, { broadActivity: true })
    const todayLocal = days.find((d) => d.isToday)!
    expect(todayLocal.tooltipLines).not.toContain('PV/CR importé')
    expect(todayLocal.count).toBe(0)
  })

  it('un PV importé dont l’effective_date tombe dans la fenêtre est positionné à cette date, pas à created_at', async () => {
    const today = new Date()
    const yesterday = new Date(today.getTime() - 86_400_000)
    const yesterdayIso = yesterday.toISOString().slice(0, 10)
    tables.site_reports = [
      { id: 'r-1', site_id: SITE, created_at: today.toISOString(), origin: 'import', source_document_id: 'doc-1' },
    ]
    tables.documents = [{ id: 'doc-1', effective_date: yesterdayIso }]

    const days = await getSiteRecentRhythm(SITE, 14, { broadActivity: true })
    const todayLocal = days.find((d) => d.isToday)!
    const yesterdayDay = days.find((d) => d.date === yesterdayIso)
    expect(todayLocal.tooltipLines).not.toContain('PV/CR importé')
    expect(yesterdayDay?.tooltipLines).toContain('PV/CR importé')
  })

  it('une visite terrain (origin non-import) garde created_at comme date, sans passer par readImportDocumentDates', async () => {
    const today = new Date().toISOString()
    tables.site_reports = [
      { id: 'r-terrain', site_id: SITE, created_at: today, origin: 'planned', source_document_id: null },
    ]

    const days = await getSiteRecentRhythm(SITE, 14, { broadActivity: true })
    const todayLocal = days.find((d) => d.isToday)!
    expect(todayLocal.tooltipLines).toContain('Visite terrain')
  })
})
