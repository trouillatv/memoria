import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIX_REQUIRED (revue ChatGPT/Vincent, 4385708e) — listTeamMembershipHistoryForUser()
// éliminait auparavant toute équipe archivée (`teams.deleted_at`) de l'historique,
// ce qui contredit la notion même d'historique complet : une équipe archivée fait
// partie du passé réel de la personne. Correctif : l'équipe archivée reste dans
// l'historique (teamArchived: true), seul le classement actuelle/ancienne (fait
// par l'appelant, cf. PersonDetailBody.tsx) en tient compte.

vi.mock('server-only', () => ({}))

let membershipRows: Array<{
  joined_at: string
  left_at: string | null
  team: { id: string; name: string; deleted_at: string | null; organization_id: string | null } | null
}> = []

function makeBuilder(resolveValue: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'order']) b[m] = self
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue()).then(resolve, reject)
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'team_members') return makeBuilder(() => ({ data: membershipRows, error: null }))
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

import { listTeamMembershipHistoryForUser } from '@/lib/db/teams'

beforeEach(() => {
  membershipRows = []
})

describe('listTeamMembershipHistoryForUser — historique complet, équipe archivée conservée', () => {
  it('membership terminé (left_at renseigné) + équipe archivée → historique conservé avec teamArchived: true', async () => {
    membershipRows = [
      {
        joined_at: '2025-01-01T00:00:00Z',
        left_at: '2025-06-01T00:00:00Z',
        team: { id: 't-1', name: 'Équipe Alpha', deleted_at: '2025-07-01T00:00:00Z', organization_id: 'org-demo' },
      },
    ]
    const out = await listTeamMembershipHistoryForUser('u-1', ['org-demo'])
    expect(out).toEqual([
      {
        teamId: 't-1',
        teamName: 'Équipe Alpha',
        joinedAt: '2025-01-01T00:00:00Z',
        leftAt: '2025-06-01T00:00:00Z',
        teamArchived: true,
      },
    ])
  })

  it('membership left_at=null + équipe archivée → conservé, teamArchived: true (jamais présenté comme actuel)', async () => {
    membershipRows = [
      {
        joined_at: '2025-01-01T00:00:00Z',
        left_at: null,
        team: { id: 't-1', name: 'Équipe Alpha', deleted_at: '2025-07-01T00:00:00Z', organization_id: 'org-demo' },
      },
    ]
    const out = await listTeamMembershipHistoryForUser('u-1', ['org-demo'])
    expect(out).toEqual([
      {
        teamId: 't-1',
        teamName: 'Équipe Alpha',
        joinedAt: '2025-01-01T00:00:00Z',
        leftAt: null,
        teamArchived: true,
      },
    ])
  })

  it('équipe non archivée, membership actif → teamArchived: false', async () => {
    membershipRows = [
      {
        joined_at: '2025-01-01T00:00:00Z',
        left_at: null,
        team: { id: 't-1', name: 'Équipe Alpha', deleted_at: null, organization_id: 'org-demo' },
      },
    ]
    const out = await listTeamMembershipHistoryForUser('u-1', ['org-demo'])
    expect(out).toEqual([
      {
        teamId: 't-1',
        teamName: 'Équipe Alpha',
        joinedAt: '2025-01-01T00:00:00Z',
        leftAt: null,
        teamArchived: false,
      },
    ])
  })

  it('équipe hors des organisations accessibles → toujours invisible, même archivée', async () => {
    membershipRows = [
      {
        joined_at: '2025-01-01T00:00:00Z',
        left_at: null,
        team: { id: 't-1', name: 'Équipe Autre Org', deleted_at: null, organization_id: 'org-autre' },
      },
    ]
    const out = await listTeamMembershipHistoryForUser('u-1', ['org-demo'])
    expect(out).toEqual([])
  })

  it('orgIds vide → fail-closed, aucune équipe', async () => {
    membershipRows = [
      {
        joined_at: '2025-01-01T00:00:00Z',
        left_at: null,
        team: { id: 't-1', name: 'Équipe Alpha', deleted_at: null, organization_id: 'org-demo' },
      },
    ]
    const out = await listTeamMembershipHistoryForUser('u-1', [])
    expect(out).toEqual([])
  })
})
