import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIX C (revue ChatGPT/Vincent, 08e355e2) — listOrphanUsers() doit ignorer les
// memberships actifs dans une équipe désactivée ou supprimée : avant ce
// correctif, seul `left_at IS NULL` était vérifié, jamais l'état de l'équipe.

vi.mock('server-only', () => ({}))

let orgIds: string[] = ['org-1']
vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: async () => orgIds,
}))

let userRows: Array<{ id: string; full_name: string | null; email: string; role: string }> = []
let membershipRows: Array<{ user_id: string; team: { active: boolean; deleted_at: string | null } }> = []

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
      if (table === 'users') return makeBuilder(() => ({ data: userRows, error: null }))
      if (table === 'team_members') return makeBuilder(() => ({ data: membershipRows, error: null }))
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

import { listOrphanUsers } from '@/lib/db/teams'

beforeEach(() => {
  orgIds = ['org-1']
  userRows = []
  membershipRows = []
})

describe('listOrphanUsers — FIX C (revue ChatGPT/Vincent, 08e355e2)', () => {
  it('user avec membership actif dans une équipe ACTIVE → pas orphelin', async () => {
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    membershipRows = [{ user_id: 'u-1', team: { active: true, deleted_at: null } }]

    const out = await listOrphanUsers()

    expect(out).toEqual([])
  })

  it('user dont l\'unique membership actif est dans une équipe DÉSACTIVÉE → orphelin', async () => {
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    membershipRows = [{ user_id: 'u-1', team: { active: false, deleted_at: null } }]

    const out = await listOrphanUsers()

    expect(out.map((u) => u.id)).toEqual(['u-1'])
  })

  it('user dont l\'unique membership actif est dans une équipe SUPPRIMÉE → orphelin', async () => {
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    membershipRows = [{ user_id: 'u-1', team: { active: true, deleted_at: '2026-01-01T00:00:00Z' } }]

    const out = await listOrphanUsers()

    expect(out.map((u) => u.id)).toEqual(['u-1'])
  })

  it('user sans aucun membership → orphelin', async () => {
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    membershipRows = []

    const out = await listOrphanUsers()

    expect(out.map((u) => u.id)).toEqual(['u-1'])
  })

  it('orgIds vide → fail-closed, aucun orphelin', async () => {
    orgIds = []
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]

    const out = await listOrphanUsers()

    expect(out).toEqual([])
  })
})
