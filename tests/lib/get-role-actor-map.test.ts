// P0-INT-4 — role facultatif (GO Vincent 2026-09-16, mig 412) : getRoleActorMap
// ne doit JAMAIS utiliser `null` comme clé commune pour les lignes sans rôle,
// sinon deux participations distinctes « rôle à préciser » s'écraseraient l'une
// l'autre. La clé de repli est l'id de la ligne site_intervenants (stable,
// unique), jamais une chaîne inventée ni `null`.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}

function makeAdmin(tables: Tables) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    const inFilters: Array<{ f: string; vs: unknown[] }> = []
    const run = () =>
      (tables[table] ?? [])
        .filter((r) => filters.every((f) => f(r)))
        .filter((r) => inFilters.every(({ f, vs }) => vs.includes(r[f])))
        .map((r) => ({ ...r }))
    const api = {
      select: () => api,
      eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
      is: (f: string, v: null) => (filters.push((r) => (r[f] ?? null) === v), api),
      in: (f: string, vs: unknown[]) => (inFilters.push({ f, vs }), api),
      order: () => api,
      then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: run(), error: null }),
    }
    return api
  }
  return { from: (t: string) => builder(t) }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdmin(TABLES) as never,
}))

import { getRoleActorMap } from '@/lib/db/site-intervenants'

const SITE = 'site-rus'
const CO_A = 'co-a'
const CO_B = 'co-b'

beforeEach(() => {
  TABLES = {
    companies: [
      { id: CO_A, name: 'Entreprise A', short_name: null },
      { id: CO_B, name: 'Entreprise B', short_name: null },
    ],
    company_contacts: [],
    site_intervenants: [],
  }
})

describe('getRoleActorMap — clé stable pour les lignes sans rôle (mig 412)', () => {
  it("recette 3 — même entreprise, rôle MOE + rôle NULL : deux entrées distinctes, aucune écrasée", async () => {
    TABLES.site_intervenants = [
      { id: 'si1', site_id: SITE, role: 'MOE', company_id: CO_A, main_contact_id: null, created_at: '2026-01-01', effective_from: '2026-01-01', effective_to: null, source_report_id: null },
      { id: 'si2', site_id: SITE, role: null, company_id: CO_A, main_contact_id: null, created_at: '2026-01-02', effective_from: '2026-01-02', effective_to: null, source_report_id: null },
    ]
    const map = await getRoleActorMap(SITE)
    expect(map.size).toBe(2)
    expect(map.has('MOE')).toBe(true)
    expect(map.has('id:si2')).toBe(true)
  })

  it('recette 4 — deux entreprises différentes sans rôle : clés distinctes, ne se collisionnent pas', async () => {
    TABLES.site_intervenants = [
      { id: 'si1', site_id: SITE, role: null, company_id: CO_A, main_contact_id: null, created_at: '2026-01-01', effective_from: '2026-01-01', effective_to: null, source_report_id: null },
      { id: 'si2', site_id: SITE, role: null, company_id: CO_B, main_contact_id: null, created_at: '2026-01-02', effective_from: '2026-01-02', effective_to: null, source_report_id: null },
    ]
    const map = await getRoleActorMap(SITE)
    expect(map.size).toBe(2)
    expect(map.get('id:si1')?.company).toBe('Entreprise A')
    expect(map.get('id:si2')?.company).toBe('Entreprise B')
  })
})
