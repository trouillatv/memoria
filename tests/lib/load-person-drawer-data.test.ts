import { describe, it, expect, vi } from 'vitest'

// FIX A (revue ChatGPT/Vincent, 08e355e2) — loadPersonDrawerData doit rester
// fail-closed jusque dans `teamHistory` : un user peut appartenir à
// PLUSIEURS organisations, `users.organization_id` (déjà vérifié en amont)
// ne suffit donc pas à garantir que SES équipes (actuelles ou passées) le
// sont aussi. Le filtrage org-scopé vit désormais dans
// `listTeamMembershipHistoryForUser` (lib/db/teams.ts), testé ici au niveau
// de l'appel (orgIds transmis tel quel) plutôt qu'au niveau SQL.
//
// FIX MULTI-ORG (revue ChatGPT/Vincent, cc83c29b) — l'autorisation d'accès au
// drawer ne doit plus jamais venir de `users.organization_id` (legacy/défaut
// dès qu'un compte a plusieurs appartenances) mais d'un membership ACTIF dans
// une organisation du viewer (organization_memberships).

let userRow: Record<string, unknown> | null = null
let contactRow: Record<string, unknown> | null = null
let membershipRow: Record<string, unknown> | null = null

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
      if (table === 'organization_memberships') return makeBuilder(() => ({ data: membershipRow, error: null }))
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

type TeamHistoryEntry = { teamId: string; teamName: string; joinedAt: string; leftAt: string | null }

const listTeamMembershipHistoryForUserMock = vi.fn(async () => [] as TeamHistoryEntry[])
const listTeamMembershipHistoryForContactMock = vi.fn(async () => [] as TeamHistoryEntry[])

vi.mock('@/lib/db/person-memory', () => ({
  getPersonMemorySummary: async () => ({ userOverview: null, contactOverview: null }),
  listConfirmedInterventionsForUser: async () => [],
  listAssignedActionsForContact: async () => [],
  listPhotosForUser: async () => [],
  listTeamMembershipHistoryForContact: (...args: unknown[]) =>
    (listTeamMembershipHistoryForContactMock as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}))

vi.mock('@/lib/db/teams', () => ({
  listTeamMembershipHistoryForUser: (...args: unknown[]) =>
    (listTeamMembershipHistoryForUserMock as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}))

import { loadPersonDrawerData } from '@/app/(dashboard)/equipes/loadPersonDrawerData'

describe('loadPersonDrawerData — teamHistory org-scopé (FIX A)', () => {
  it('user — orgIds du viewer transmis tel quel à listTeamMembershipHistoryForUser', async () => {
    userRow = { id: 'u-1', full_name: 'Jean Dupont', email: 'jean@test.com', role: 'chef_equipe', deleted_at: null }
    membershipRow = { id: 'm-1' }
    listTeamMembershipHistoryForUserMock.mockResolvedValueOnce([
      { teamId: 't-a', teamName: 'Équipe A', joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null },
    ])

    const out = await loadPersonDrawerData('u-1', 'user', ['org-a'], '30')

    expect(listTeamMembershipHistoryForUserMock).toHaveBeenCalledWith('u-1', ['org-a'])
    expect(out?.teamHistory).toEqual([
      { teamId: 't-a', teamName: 'Équipe A', joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null },
    ])
  })

  it('user sans historique renvoyé par le helper org-scopé → teamHistory vide', async () => {
    userRow = { id: 'u-1', full_name: 'Jean Dupont', email: 'jean@test.com', role: 'chef_equipe', deleted_at: null }
    membershipRow = { id: 'm-1' }
    listTeamMembershipHistoryForUserMock.mockResolvedValueOnce([])

    const out = await loadPersonDrawerData('u-1', 'user', ['org-a'], '30')

    expect(out?.teamHistory).toEqual([])
  })

  it('contact — orgIds du viewer transmis tel quel à listTeamMembershipHistoryForContact', async () => {
    contactRow = { id: 'c-1', full_name: 'Marie Test', function: null, organization_id: 'org-a', deleted_at: null, company: null }
    listTeamMembershipHistoryForContactMock.mockResolvedValueOnce([])

    await loadPersonDrawerData('c-1', 'contact', ['org-a'], '30')

    expect(listTeamMembershipHistoryForContactMock).toHaveBeenCalledWith('c-1', ['org-a'])
  })

  it('contact avec historique passé (leftAt renseigné) → propagé tel quel dans teamHistory', async () => {
    contactRow = { id: 'c-1', full_name: 'Marie Test', function: null, organization_id: 'org-a', deleted_at: null, company: null }
    listTeamMembershipHistoryForContactMock.mockResolvedValueOnce([
      { teamId: 't-a', teamName: 'Équipe A', joinedAt: '2025-01-01T00:00:00.000Z', leftAt: '2025-06-01T00:00:00.000Z' },
    ])

    const out = await loadPersonDrawerData('c-1', 'contact', ['org-a'], '30')

    expect(out?.teamHistory).toEqual([
      { teamId: 't-a', teamName: 'Équipe A', joinedAt: '2025-01-01T00:00:00.000Z', leftAt: '2025-06-01T00:00:00.000Z' },
    ])
  })
})

describe('loadPersonDrawerData — MULTI-ORG canonicalité (revue ChatGPT/Vincent, cc83c29b)', () => {
  it('users.organization_id = org-B mais membership ACTIF org-A, viewer org-A → drawer ACCESSIBLE', async () => {
    // users.organization_id n'est même plus sélectionné/lu pour la garde —
    // seul le membership actif décide.
    userRow = { id: 'u-1', full_name: 'Jean Dupont', email: 'jean@test.com', role: 'chef_equipe', deleted_at: null }
    membershipRow = { id: 'm-1' }
    listTeamMembershipHistoryForUserMock.mockResolvedValueOnce([])

    const out = await loadPersonDrawerData('u-1', 'user', ['org-a'], '30')

    expect(out).not.toBeNull()
    expect(out?.displayName).toBe('Jean Dupont')
  })

  it('aucun membership actif dans les organisations du viewer → drawer refusé (fail-closed)', async () => {
    userRow = { id: 'u-1', full_name: 'Jean Dupont', email: 'jean@test.com', role: 'chef_equipe', deleted_at: null }
    membershipRow = null

    const out = await loadPersonDrawerData('u-1', 'user', ['org-a'], '30')

    expect(out).toBeNull()
  })

  it('orgIds vide → fail-closed avant toute requête', async () => {
    userRow = { id: 'u-1', full_name: 'Jean Dupont', email: 'jean@test.com', role: 'chef_equipe', deleted_at: null }
    membershipRow = { id: 'm-1' }

    const out = await loadPersonDrawerData('u-1', 'user', [], '30')

    expect(out).toBeNull()
  })
})
