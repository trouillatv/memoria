// P0-INT-2 — unicité entreprise cross-site (mandat Vincent 2026-09-16).
// findOrCreateCompanyByName doit résoudre tout exact-match sur une ligne
// status='alias' vers son canonique : sinon une citation ultérieure du nom-alias
// sur un autre chantier écrit ses relations sur le mauvais id (unicité logique en
// lecture, pas en écriture). Témoin : Clim Exp'Air (canonical) / Clim Expair (alias).

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}
let nextId = 0

function makeAdmin(tables: Tables) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    const run = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }))
    const api = {
      select: () => api,
      eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
      is: (f: string, v: null) => (filters.push((r) => (r[f] ?? null) === v), api),
      ilike: (f: string, v: string) => (filters.push((r) => String(r[f] ?? '').toLowerCase() === v.toLowerCase()), api),
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      insert: (payload: Row) => {
        const row: Row = { id: `co-new-${++nextId}`, deleted_at: null, status: 'active', alias_of_company_id: null, ...payload }
        tables[table] = [...(tables[table] ?? []), row]
        return { select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }) }
      },
    }
    return api
  }
  return { from: (t: string) => builder(t) }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdmin(TABLES) as never,
}))

import { findOrCreateCompanyByName } from '@/lib/db/companies'

const ORG = 'org-agp'
const ORG_2 = 'org-capse-nc'
const CANONICAL_ID = 'co-clim-canonical'
const ALIAS_ID = 'co-clim-alias'

function seed(): Tables {
  return {
    companies: [
      { id: CANONICAL_ID, organization_id: ORG, name: "Clim Exp'Air", status: 'active', alias_of_company_id: null, deleted_at: null, is_placeholder: false },
      { id: ALIAS_ID, organization_id: ORG, name: 'Clim Expair', status: 'alias', alias_of_company_id: CANONICAL_ID, deleted_at: null, is_placeholder: false },
    ],
  }
}

beforeEach(() => {
  TABLES = seed()
  nextId = 0
})

describe('findOrCreateCompanyByName — résolution alias→canonique (P0-INT-2)', () => {
  it('exact-match sur le nom ALIAS résout immédiatement vers le canonique, sans nouvelle entreprise', async () => {
    const id = await findOrCreateCompanyByName(ORG, 'Clim Expair')
    expect(id).toBe(CANONICAL_ID)
    expect(TABLES.companies).toHaveLength(2)
  })

  it('replay/idempotence : deux appels identiques renvoient le même canonique, sans écriture supplémentaire', async () => {
    const first = await findOrCreateCompanyByName(ORG, 'Clim Expair')
    const second = await findOrCreateCompanyByName(ORG, 'Clim Expair')
    expect(first).toBe(CANONICAL_ID)
    expect(second).toBe(CANONICAL_ID)
    expect(TABLES.companies).toHaveLength(2)
  })

  it('non-régression : exact-match sur une ligne déjà canonique (active) reste un pass-through', async () => {
    const id = await findOrCreateCompanyByName(ORG, "Clim Exp'Air")
    expect(id).toBe(CANONICAL_ID)
    expect(TABLES.companies).toHaveLength(2)
  })

  it("aucun match dans l'org → comportement de création inchangé", async () => {
    const id = await findOrCreateCompanyByName(ORG, 'Société Jamais Vue')
    expect(id).not.toBe(CANONICAL_ID)
    expect(id).not.toBe(ALIAS_ID)
    expect(TABLES.companies).toHaveLength(3)
    const created = TABLES.companies.find((c) => c.id === id)
    expect(created?.organization_id).toBe(ORG)
    expect(created?.name).toBe('Société Jamais Vue')
  })

  it("le scope organisation est conservé : le même nom-alias dans une AUTRE org ne résout vers rien et crée sa propre entreprise", async () => {
    const id = await findOrCreateCompanyByName(ORG_2, 'Clim Expair')
    expect(id).not.toBe(CANONICAL_ID)
    expect(id).not.toBe(ALIAS_ID)
    const created = TABLES.companies.find((c) => c.id === id)
    expect(created?.organization_id).toBe(ORG_2)
  })
})
