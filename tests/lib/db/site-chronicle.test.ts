// CANONICAL-READ-2 — getSiteChronicle lit désormais site_reserve.canonical_subject_id
// (même route que reserve-fiche.ts, commit c918de52) pour la branche réserve.
// Les décisions restent sur `subjects`/`subject_id` legacy (site_decisions n'a
// aucune colonne canonique). Aucun matching, aucun fallback.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}

function makeAdmin(tables: Tables) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    const run = () => {
      const rows = tables[table] ?? []
      return rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }))
    }
    const api = {
      select: () => api,
      eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
      in: (f: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[f])), api),
      order: () => api,
      limit: () => api,
      then: (resolve: (x: { data: Row[]; error: null }) => void) => resolve({ data: run(), error: null }),
    }
    return api
  }
  return { from: (t: string) => builder(t) }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdmin(TABLES) as never,
}))
vi.mock('@/lib/db/site-memory', () => ({
  getSiteMemoryTimeline: () => Promise.resolve([]),
}))
vi.mock('@/lib/db/documents', () => ({
  listDocumentsForTarget: () => Promise.resolve([]),
}))
vi.mock('@/lib/db/meeting-enrichments', () => ({
  getSiteRecentEnrichments: () => Promise.resolve([]),
}))

import { getSiteChronicle } from '@/lib/db/site-chronicle'

const SITE = 'site-1'

function seed(): Tables {
  return {
    site_decisions: [
      { id: 'd-legacy', site_id: SITE, titre: 'Décision legacy', description: null, date_decision: '2026-01-01', created_at: '2026-01-01T00:00:00Z', subject_id: 'legacy-subject-id' },
    ],
    site_reserve: [
      { id: 'r-canonique', site_id: SITE, label: 'Réserve rattachée', location: null, status: 'open', created_at: '2026-01-02T00:00:00Z', canonical_subject_id: 'cs-consignes' },
      { id: 'r-sans-sujet', site_id: SITE, label: 'Réserve sans sujet', location: null, status: 'open', created_at: '2026-01-03T00:00:00Z', canonical_subject_id: null },
    ],
    subjects: [{ id: 'legacy-subject-id', name: 'Sujet legacy' }],
    canonical_subject: [{ id: 'cs-consignes', label: 'Consignes d’exploitation' }],
  }
}

beforeEach(() => {
  TABLES = seed()
})

describe('getSiteChronicle — réserves sur canonical_subject_id (CANONICAL-READ-2)', () => {
  it('une réserve avec canonical_subject_id nomme le sujet via canonical_subject et pointe vers /historique/sujets', async () => {
    const events = await getSiteChronicle(SITE)
    const res = events.find((e) => e.id === 'res-r-canonique')
    expect(res?.subjectLabel).toBe('Consignes d’exploitation')
    expect(res?.href).toBe(`/sites/${SITE}/historique/sujets/cs-consignes`)
  })

  it('une réserve sans canonical_subject_id reste honnêtement sans sujet (aucun fallback subject_id)', async () => {
    const events = await getSiteChronicle(SITE)
    const res = events.find((e) => e.id === 'res-r-sans-sujet')
    expect(res?.subjectLabel).toBeNull()
    expect(res?.href).toBe(`/sites/${SITE}/reserves`)
  })

  it('une décision reste sur la route legacy (subjects/subject_id), inchangée', async () => {
    const events = await getSiteChronicle(SITE)
    const dec = events.find((e) => e.id === 'dec-d-legacy')
    expect(dec?.subjectLabel).toBe('Sujet legacy')
    expect(dec?.href).toBe(`/sites/${SITE}/subjects/legacy-subject-id`)
  })
})
