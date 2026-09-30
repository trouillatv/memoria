import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIX 4 (revue ChatGPT/Vincent, cd30aa2d) — l'effectif d'une équipe ne peut
// plus se limiter aux utilisateurs connectés (team_members) : les personnes
// terrain (team_field_members) sont des membres actifs à part entière.
// getTeamOverview doit exposer les deux populations séparément
// (appUserMemberCount, fieldMemberCount) et leur somme (memberCountTotal),
// sans jamais les dédoublonner par nom/email (tables disjointes par nature).

vi.mock('server-only', () => ({}))

let teamRow: Record<string, unknown> | null = null
let appUserMemberCount = 0
let fieldMemberCount = 0

function countBuilder(count: number) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'is', 'in']) b[m] = self
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ count, data: [], error: null }).then(resolve, reject)
  return b
}

function singleBuilder(row: unknown) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'is']) b[m] = self
  b.maybeSingle = () => Promise.resolve({ data: row, error: null })
  return b
}

function emptyBuilder() {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in']) b[m] = self
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject)
  b.maybeSingle = () => Promise.resolve({ data: null, error: null })
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'teams') return singleBuilder(teamRow)
      if (table === 'team_members') return countBuilder(appUserMemberCount)
      if (table === 'team_field_members') return countBuilder(fieldMemberCount)
      return emptyBuilder()
    },
  }),
}))

vi.mock('@/lib/storage/intervention-photos', () => ({
  getSignedPhotoUrlsThumb: async (paths: string[]) => new Map(paths.map((p) => [p, `signed://${p}`])),
}))

vi.mock('@/lib/db/teams', () => ({
  getTeamDependencies: async () => ({ futureInterventions: 0, rotationSlots: 0, rotationCycleCount: 0, rotationSiteNames: [] }),
}))

import { getTeamOverview } from '@/lib/db/team-profile'

beforeEach(() => {
  teamRow = {
    id: 't-1',
    name: 'Alpha',
    organization_id: 'org-1',
    color: null,
    icon: null,
    specialties: [],
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    referent_user_id: null,
    deleted_at: null,
  }
  appUserMemberCount = 0
  fieldMemberCount = 0
})

describe('FIX 4 — getTeamOverview : effectif total = team_members + team_field_members', () => {
  it('2 comptes + 3 terrain → appUserMemberCount=2, fieldMemberCount=3, memberCountTotal=5', async () => {
    appUserMemberCount = 2
    fieldMemberCount = 3
    const out = await getTeamOverview('t-1')
    expect(out?.appUserMemberCount).toBe(2)
    expect(out?.fieldMemberCount).toBe(3)
    expect(out?.memberCountTotal).toBe(5)
  })

  it('aucun compte, seulement du terrain → total = terrain uniquement', async () => {
    appUserMemberCount = 0
    fieldMemberCount = 4
    const out = await getTeamOverview('t-1')
    expect(out?.appUserMemberCount).toBe(0)
    expect(out?.fieldMemberCount).toBe(4)
    expect(out?.memberCountTotal).toBe(4)
  })

  it('aucune personne terrain → total = comptes uniquement (rétro-compatible)', async () => {
    appUserMemberCount = 6
    fieldMemberCount = 0
    const out = await getTeamOverview('t-1')
    expect(out?.memberCountTotal).toBe(6)
  })
})
