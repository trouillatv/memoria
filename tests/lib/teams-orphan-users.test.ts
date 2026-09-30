import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIX C (revue ChatGPT/Vincent, 08e355e2) — listOrphanUsers() doit ignorer les
// memberships actifs dans une équipe désactivée ou supprimée : avant ce
// correctif, seul `left_at IS NULL` était vérifié, jamais l'état de l'équipe.
//
// FIX MULTI-ORG (revue ChatGPT/Vincent, cc83c29b) — la population candidate
// vient désormais de `organization_memberships` ACTIVE, jamais de
// `users.organization_id` ; le rattachement à une équipe est aussi scopé par
// `teams.organization_id IN orgIds` (une équipe active hors périmètre ne doit
// ni faire apparaître, ni faire disparaître un orphelin).

vi.mock('server-only', () => ({}))

let orgIds: string[] = ['org-1']
vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: async () => orgIds,
}))

let activeMembershipRows: Array<{ user_id: string }> = []
let userRows: Array<{ id: string; full_name: string | null; email: string; role: string }> = []
let membershipRows: Array<{
  user_id: string
  team: { active: boolean; deleted_at: string | null; organization_id: string | null }
}> = []

function makeBuilder(resolveValue: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'neq', 'is', 'in', 'order']) b[m] = self
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue()).then(resolve, reject)
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'organization_memberships') return makeBuilder(() => ({ data: activeMembershipRows, error: null }))
      if (table === 'users') return makeBuilder(() => ({ data: userRows, error: null }))
      if (table === 'team_members') return makeBuilder(() => ({ data: membershipRows, error: null }))
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

import { listOrphanUsers } from '@/lib/db/teams'

beforeEach(() => {
  orgIds = ['org-1']
  activeMembershipRows = []
  userRows = []
  membershipRows = []
})

describe('listOrphanUsers — FIX C (revue ChatGPT/Vincent, 08e355e2)', () => {
  it('user avec membership actif dans une équipe ACTIVE de son organisation → pas orphelin', async () => {
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    membershipRows = [{ user_id: 'u-1', team: { active: true, deleted_at: null, organization_id: 'org-1' } }]

    const out = await listOrphanUsers()

    expect(out).toEqual([])
  })

  it('user dont l\'unique membership actif est dans une équipe DÉSACTIVÉE → orphelin', async () => {
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    membershipRows = [{ user_id: 'u-1', team: { active: false, deleted_at: null, organization_id: 'org-1' } }]

    const out = await listOrphanUsers()

    expect(out.map((u) => u.id)).toEqual(['u-1'])
  })

  it('user dont l\'unique membership actif est dans une équipe SUPPRIMÉE → orphelin', async () => {
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    membershipRows = [
      { user_id: 'u-1', team: { active: true, deleted_at: '2026-01-01T00:00:00Z', organization_id: 'org-1' } },
    ]

    const out = await listOrphanUsers()

    expect(out.map((u) => u.id)).toEqual(['u-1'])
  })

  it('user sans aucun membership → orphelin', async () => {
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    membershipRows = []

    const out = await listOrphanUsers()

    expect(out.map((u) => u.id)).toEqual(['u-1'])
  })

  it('orgIds vide → fail-closed, aucun orphelin', async () => {
    orgIds = []
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]

    const out = await listOrphanUsers()

    expect(out).toEqual([])
  })

  it('MULTI-ORG — user visible via organization_memberships (org-A) alors que users.organization_id pointerait vers org-B, sans équipe org-A → reste orphelin', async () => {
    // La population candidate vient EXCLUSIVEMENT de organization_memberships :
    // users.organization_id n'intervient même plus dans la requête `users`
    // (elle filtre seulement par id IN candidateUserIds). Ce witness vérifie
    // que la présence dans organization_memberships suffit à faire apparaître
    // l'utilisateur, peu importe sa colonne legacy.
    orgIds = ['org-a']
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    membershipRows = []

    const out = await listOrphanUsers()

    expect(out.map((u) => u.id)).toEqual(['u-1'])
  })

  it('MULTI-ORG — équipe active mais hors organisations du viewer → ignorée, user reste orphelin', async () => {
    orgIds = ['org-a']
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    // Équipe active et non supprimée, mais organisation org-b — hors périmètre du viewer.
    membershipRows = [{ user_id: 'u-1', team: { active: true, deleted_at: null, organization_id: 'org-b' } }]

    const out = await listOrphanUsers()

    expect(out.map((u) => u.id)).toEqual(['u-1'])
  })

  it('MULTI-ORG — viewer avec deux organisations, équipe active dans l\'une d\'elles suffit à ne pas être orphelin', async () => {
    orgIds = ['org-a', 'org-b']
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    membershipRows = [{ user_id: 'u-1', team: { active: true, deleted_at: null, organization_id: 'org-b' } }]

    const out = await listOrphanUsers()

    expect(out).toEqual([])
  })
})
