import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIX MULTI-ORG (revue ChatGPT/Vincent, cc83c29b) — listAssignableMembers()
// doit puiser sa population dans organization_memberships ACTIVE (jamais
// users.organization_id), et ne jamais exposer le nom d'une équipe hors des
// organisations du viewer dans `currentTeamNames`.

vi.mock('server-only', () => ({}))

let activeMembershipRows: Array<{ user_id: string }> = []
let userRows: Array<{ id: string; full_name: string | null; email: string; role: string }> = []
let teamMemberRows: Array<{
  user_id: string
  team: { id: string; name: string; deleted_at: string | null; organization_id: string | null } | null
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
      if (table === 'team_members') return makeBuilder(() => ({ data: teamMemberRows, error: null }))
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

import { listAssignableMembers } from '@/app/(dashboard)/equipes/page'

beforeEach(() => {
  activeMembershipRows = []
  userRows = []
  teamMemberRows = []
})

describe('listAssignableMembers — MULTI-ORG canonicalité (revue ChatGPT/Vincent, cc83c29b)', () => {
  it('orgIds vide → fail-closed, aucune personne', async () => {
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]

    const out = await listAssignableMembers([])

    expect(out).toEqual([])
  })

  it('personne visible via membership actif org-A alors que sans lien via users.organization_id', async () => {
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    teamMemberRows = []

    const out = await listAssignableMembers(['org-a'])

    expect(out.map((m) => m.id)).toEqual(['u-1'])
  })

  it('personne visible en org-A + équipe org-A + équipe org-B (inaccessible) → currentTeamNames contient UNIQUEMENT l\'équipe A', async () => {
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    teamMemberRows = [
      { user_id: 'u-1', team: { id: 't-a', name: 'Équipe A', deleted_at: null, organization_id: 'org-a' } },
      { user_id: 'u-1', team: { id: 't-b', name: 'Équipe B', deleted_at: null, organization_id: 'org-b' } },
    ]

    const out = await listAssignableMembers(['org-a'])

    expect(out).toHaveLength(1)
    expect(out[0]?.currentTeamNames).toEqual(['Équipe A'])
  })

  it('équipe supprimée (deleted_at) dans l\'organisation du viewer → jamais dans currentTeamNames', async () => {
    activeMembershipRows = [{ user_id: 'u-1' }]
    userRows = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    teamMemberRows = [
      { user_id: 'u-1', team: { id: 't-a', name: 'Équipe supprimée', deleted_at: '2026-01-01T00:00:00Z', organization_id: 'org-a' } },
    ]

    const out = await listAssignableMembers(['org-a'])

    expect(out[0]?.currentTeamNames).toEqual([])
  })
})
