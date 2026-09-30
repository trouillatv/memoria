import { describe, it, expect, vi } from 'vitest'

// FIX A (revue ChatGPT/Vincent, 08e355e2) — loadPersonDrawerData doit rester
// fail-closed jusque dans `currentTeams` : un user peut appartenir à
// PLUSIEURS organisations, `users.organization_id` (déjà vérifié en amont)
// ne suffit donc pas à garantir que SES équipes actuelles le sont aussi.

let userRow: Record<string, unknown> | null = null
let contactRow: Record<string, unknown> | null = null
let teamMembershipRows: Array<Record<string, unknown>> = []

function makeBuilder(resolveValue: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'in']) b[m] = self
  b.maybeSingle = () => Promise.resolve(resolveValue())
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue()).then(resolve, reject)
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'users') return makeBuilder(() => ({ data: userRow, error: null }))
      if (table === 'company_contacts') return makeBuilder(() => ({ data: contactRow, error: null }))
      if (table === 'team_members') return makeBuilder(() => ({ data: teamMembershipRows, error: null }))
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

const listTeamMembershipsForContactMock = vi.fn(async () => [] as Array<{ teamId: string; teamName: string; joinedAt: string }>)

vi.mock('@/lib/db/person-memory', () => ({
  getPersonMemorySummary: async () => ({ userOverview: null, contactOverview: null }),
  listConfirmedInterventionsForUser: async () => [],
  listAssignedActionsForContact: async () => [],
  listPhotosForUser: async () => [],
  listTeamMembershipsForContact: (...args: unknown[]) =>
    (listTeamMembershipsForContactMock as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}))

import { loadPersonDrawerData } from '@/app/(dashboard)/equipes/loadPersonDrawerData'

describe('loadPersonDrawerData — currentTeams org-scopé (FIX A)', () => {
  it('user membre d’une équipe org A + une équipe org B, viewer org A seulement → ne retourne que l’équipe A', async () => {
    userRow = { id: 'u-1', full_name: 'Jean Dupont', email: 'jean@test.com', role: 'chef_equipe', organization_id: 'org-a', deleted_at: null }
    teamMembershipRows = [
      { team: { id: 't-a', name: 'Équipe A', deleted_at: null, organization_id: 'org-a' } },
      { team: { id: 't-b', name: 'Équipe B', deleted_at: null, organization_id: 'org-b' } },
    ]

    const out = await loadPersonDrawerData('u-1', 'user', ['org-a'], '30')

    expect(out).not.toBeNull()
    expect(out?.currentTeams).toEqual([{ teamId: 't-a', teamName: 'Équipe A' }])
  })

  it('user sans aucune équipe accessible au viewer → currentTeams vide (pas de fuite)', async () => {
    userRow = { id: 'u-1', full_name: 'Jean Dupont', email: 'jean@test.com', role: 'chef_equipe', organization_id: 'org-a', deleted_at: null }
    teamMembershipRows = [
      { team: { id: 't-b', name: 'Équipe B', deleted_at: null, organization_id: 'org-b' } },
    ]

    const out = await loadPersonDrawerData('u-1', 'user', ['org-a'], '30')

    expect(out?.currentTeams).toEqual([])
  })

  it('contact — orgIds du viewer transmis tel quel à listTeamMembershipsForContact', async () => {
    contactRow = { id: 'c-1', full_name: 'Marie Test', function: null, organization_id: 'org-a', deleted_at: null, company: null }

    await loadPersonDrawerData('c-1', 'contact', ['org-a'], '30')

    expect(listTeamMembershipsForContactMock).toHaveBeenCalledWith('c-1', ['org-a'])
  })
})
