// P0-INT-3 — parcours « À identifier » (mandat Vincent 2026-09-16).
// searchIntervenantTargetsAction doit résoudre tout nom-alias (« DIMINC ») vers
// son canonique (« DIMENC ») : jamais présenter/rattacher une ligne alias comme
// cible, même quand seul le texte de l'alias matche la recherche tapée. Même
// doctrine qu'à l'écriture (findOrCreateCompanyByName, P0-INT-2), étendue à la
// lecture/recherche. Témoin : DIMENC (canonique) / DIMINC (alias).

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}

function makeAdmin(tables: Tables) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    const inFilters: Array<{ f: string; vs: unknown[] }> = []
    const ilikeFilters: Array<{ f: string; v: string }> = []
    const run = () =>
      (tables[table] ?? [])
        .filter((r) => filters.every((f) => f(r)))
        .filter((r) => inFilters.every(({ f, vs }) => vs.includes(r[f])))
        .filter(({ ...r }: Row) => ilikeFilters.every(({ f, v }) => String(r[f] ?? '').toLowerCase().includes(v.toLowerCase())))
        .map((r) => ({ ...r }))
    const api = {
      select: () => api,
      eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
      is: (f: string, v: null) => (filters.push((r) => (r[f] ?? null) === v), api),
      in: (f: string, vs: unknown[]) => (inFilters.push({ f, vs }), api),
      ilike: (f: string, v: string) => (ilikeFilters.push({ f, v: v.replace(/%/g, '') }), api),
      order: () => api,
      limit: () => Promise.resolve({ data: run(), error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: run(), error: null }),
    }
    return api
  }
  return { from: (t: string) => builder(t) }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdmin(TABLES) as never,
}))

const ORG = 'org-agp'
const SITE = '11111111-1111-4111-8111-111111111111'
vi.mock('@/lib/auth/site-write-access', () => ({
  requireSiteWriteAccess: async () => ({ ok: true, organizationId: ORG, userId: 'u1', role: 'admin' }),
}))
vi.mock('@/lib/knowledge/invalidate', () => ({ invalidateSiteProjection: async () => {} }))
vi.mock('@/lib/db/usage-events', () => ({ logUsageEvent: async () => {} }))

import { searchIntervenantTargetsAction } from '@/app/(dashboard)/sites/[id]/views/intervenants/intervenants-actions'

const CANONICAL_ID = 'co-dimenc'
const ALIAS_ID = 'co-diminc'

function seed(): Tables {
  return {
    companies: [
      { id: CANONICAL_ID, organization_id: ORG, name: 'DIMENC', short_name: null, status: 'active', alias_of_company_id: null, deleted_at: null },
      { id: ALIAS_ID, organization_id: ORG, name: 'DIMINC', short_name: null, status: 'alias', alias_of_company_id: CANONICAL_ID, deleted_at: null },
    ],
    site_intervenants: [],
    company_contacts: [],
  }
}

beforeEach(() => {
  TABLES = seed()
})

describe('searchIntervenantTargetsAction — résolution alias→canonique (P0-INT-3)', () => {
  it('chercher le nom ALIAS ("DIMINC") fait remonter le CANONIQUE ("DIMENC"), jamais l’alias', async () => {
    const res = await searchIntervenantTargetsAction({ site_id: SITE, q: 'DIMINC' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const companyHits = res.hits.filter((h) => h.kind === 'company')
    expect(companyHits).toHaveLength(1)
    expect(companyHits[0].companyId).toBe(CANONICAL_ID)
    expect(companyHits[0].name).toBe('DIMENC')
  })

  it('chercher le nom canonique ("DIMENC") reste un pass-through', async () => {
    const res = await searchIntervenantTargetsAction({ site_id: SITE, q: 'DIMENC' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const companyHits = res.hits.filter((h) => h.kind === 'company')
    expect(companyHits).toHaveLength(1)
    expect(companyHits[0].companyId).toBe(CANONICAL_ID)
  })

  it('aucun doublon si le texte tapé matche à la fois le canonique et son alias', async () => {
    // short_name du canonique ET nom de l'alias contiennent tous deux « DIM » :
    // les deux lignes matchent le texte, mais résolvent vers le MÊME canonique.
    TABLES.companies[0] = { ...TABLES.companies[0], short_name: 'DIM' }
    const res = await searchIntervenantTargetsAction({ site_id: SITE, q: 'DIM' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const ids = res.hits.filter((h) => h.kind === 'company').map((h) => h.companyId)
    expect(ids).toEqual([CANONICAL_ID])
  })
})
