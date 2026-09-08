// LOT CANONICAL READ-MODEL 1 — getSiteReserveFiche.sujet lit désormais
// site_reserve.canonical_subject_id (même route que reserves-pilotage.ts),
// plus jamais le subject_id legacy. Aucun matching, aucun fallback.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}

function makeAdmin(tables: Tables) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    const order: Array<(a: Row, b: Row) => number> = []
    const run = () => {
      const rows = tables[table] ?? []
      const matched = rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }))
      for (const cmp of order) matched.sort(cmp)
      return matched
    }
    const api = {
      select: () => api,
      eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
      in: (f: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[f])), api),
      is: (f: string, v: null) => (filters.push((r) => (r[f] ?? null) === v), api),
      not: (f: string, _op: string, v: null) => (filters.push((r) => (r[f] ?? null) !== v), api),
      order: () => api,
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (x: { data: Row[]; error: null }) => void) => resolve({ data: run(), error: null }),
    }
    return api
  }
  return { from: (t: string) => builder(t) }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdmin(TABLES) as never,
}))
vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: () => Promise.resolve(['org-1']),
}))

import { getSiteReserveFiche } from '@/lib/knowledge/reserve-fiche'

const SITE = 'site-1'

function seed(): Tables {
  return {
    sites: [{ id: SITE, organization_id: 'org-1' }],
    canonical_subject: [{ id: 'cs-consignes', label: 'Consignes d’exploitation' }],
    site_reserve: [
      { id: 'r-canonique', site_id: SITE, label: 'Réserve rattachée', location: null, issued_by: null, issued_on: null, status: 'open', lifted_at: null, lift_note: null, canonical_subject_id: 'cs-consignes', subject_id: null, photo_before_path: null, photo_after_path: null, report_id: null },
      { id: 'r-legacy', site_id: SITE, label: 'Réserve legacy seule', location: null, issued_by: null, issued_on: null, status: 'open', lifted_at: null, lift_note: null, canonical_subject_id: null, subject_id: 'legacy-subject-id', photo_before_path: null, photo_after_path: null, report_id: null },
      { id: 'r-sans-sujet', site_id: SITE, label: 'Réserve sans sujet', location: null, issued_by: null, issued_on: null, status: 'open', lifted_at: null, lift_note: null, canonical_subject_id: null, subject_id: null, photo_before_path: null, photo_after_path: null, report_id: null },
    ],
    site_actions: [],
  }
}

beforeEach(() => {
  TABLES = seed()
})

describe('getSiteReserveFiche — sujet route canonique (LOT CANONICAL READ-MODEL 1)', () => {
  it('une réserve avec canonical_subject_id retrouve son sujet, résolu via canonical_subject', async () => {
    const fiche = await getSiteReserveFiche(SITE, 'r-canonique')
    expect(fiche).not.toBeNull()
    expect(fiche!.sujet).toEqual({ nom: 'Consignes d’exploitation', href: `/sites/${SITE}/historique/sujets/cs-consignes` })
  })

  it('une réserve avec seulement subject_id legacy ne pilote plus le sujet (aucun sujet fabriqué)', async () => {
    const fiche = await getSiteReserveFiche(SITE, 'r-legacy')
    expect(fiche).not.toBeNull()
    expect(fiche!.sujet).toBeNull()
  })

  it('une réserve sans aucun rattachement reste honnêtement sans sujet', async () => {
    const fiche = await getSiteReserveFiche(SITE, 'r-sans-sujet')
    expect(fiche).not.toBeNull()
    expect(fiche!.sujet).toBeNull()
  })
})
