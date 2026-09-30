import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIX MULTI-ORG (revue ChatGPT/Vincent, cc83c29b) — loadTeamDrawerData() doit
// comparer l'organisation RÉELLE de l'équipe à TOUTES les organisations
// accessibles au viewer (orgIds), jamais à `users.organization_id` (une
// seule organisation par défaut/legacy dès qu'un compte a plusieurs
// appartenances).

vi.mock('server-only', () => ({}))

let overview: { organizationId: string | null; ageDays: number } | null = null

vi.mock('@/lib/db/team-profile', () => ({
  getTeamOverview: async () => overview,
  listTeamFavoriteSites: async () => [],
  listTeamContractsCovered: async () => [],
  getTeamRhythm14d: async () => ({}),
  getTeamHeatmap90d: async () => ({}),
  listTeamCompanions: async () => [],
  listTeamRecentInterventions: async () => [],
  listTeamRecentPhotos: async () => [],
}))

vi.mock('@/lib/db/teams', () => ({
  listMembersOfTeam: async () => [],
}))

vi.mock('@/lib/db/team-field-members', () => ({
  listFieldMembersOfTeam: async () => [],
}))

const getTeamActorInsightMock = vi.fn(async () => ({}))
vi.mock('@/lib/db/team-actor-insight', () => ({
  getTeamActorInsight: (...args: unknown[]) =>
    (getTeamActorInsightMock as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}))

const listOrgCatalogMock = vi.fn(async () => [])
vi.mock('@/lib/db/org-catalog', () => ({
  listOrgCatalog: (...args: unknown[]) =>
    (listOrgCatalogMock as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {}
      const self = () => b
      for (const m of ['select', 'eq', 'is', 'order']) b[m] = self
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve)
      return b
    },
  }),
}))

import { loadTeamDrawerData } from '@/app/(dashboard)/equipes/loadTeamDrawerData'

beforeEach(() => {
  overview = null
  getTeamActorInsightMock.mockClear()
  listOrgCatalogMock.mockClear()
})

describe('loadTeamDrawerData — MULTI-ORG canonicalité (revue ChatGPT/Vincent, cc83c29b)', () => {
  it('équipe org-B, viewer accessible à org-A ET org-B → drawer OUVERT sur org-B', async () => {
    overview = { organizationId: 'org-b', ageDays: 10 }

    const out = await loadTeamDrawerData('team-1', ['org-a', 'org-b'])

    expect(out).not.toBeNull()
    expect(getTeamActorInsightMock).toHaveBeenCalledWith('team-1', ['org-b'])
    expect(listOrgCatalogMock).toHaveBeenCalledWith('org-b', 'team_specialty')
  })

  it('équipe org-C, viewer accessible à org-A ET org-B seulement → drawer REFUSÉ (null)', async () => {
    overview = { organizationId: 'org-c', ageDays: 10 }

    const out = await loadTeamDrawerData('team-1', ['org-a', 'org-b'])

    expect(out).toBeNull()
  })

  it('orgIds vide → fail-closed, drawer refusé même si l\'équipe existe', async () => {
    overview = { organizationId: 'org-a', ageDays: 10 }

    const out = await loadTeamDrawerData('team-1', [])

    expect(out).toBeNull()
  })

  it('équipe introuvable (overview null) → drawer refusé', async () => {
    overview = null

    const out = await loadTeamDrawerData('team-1', ['org-a'])

    expect(out).toBeNull()
  })
})
