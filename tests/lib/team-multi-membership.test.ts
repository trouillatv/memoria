import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { addMemberToTeam, removeMemberFromTeam, listActiveTeamIdsForUser } from '@/lib/db/teams'

// /EQUIPES V2 — tests requis Vincent :
//   · 2 équipes simultanées (et son cas concret : équipe du matin / équipe de
//     l'après-midi — même mécanisme, MemorIA ne modélise pas d'horaire par
//     équipe, donc « appartenir à 2 équipes en même temps » EST le test) ;
//   · un changement de composition ne réécrit jamais l'historique d'une
//     AUTRE équipe (indépendance des lignes team_members).
//
// DB réelle (comme tests/lib/team-members-org-integrity.test.ts) : c'est une
// contrainte d'absence (pas d'exclusivité), la preuve la plus fiable est
// l'écriture réelle, pas un mock qui pourrait cacher une contrainte SQL.

const TEST_TEAM_NAME_1 = `__test_multi_team_1_${Date.now()}`
const TEST_TEAM_NAME_2 = `__test_multi_team_2_${Date.now()}`
const TEST_USER_EMAIL = `__test_multi_team_user_${Date.now()}@example.test`

let organizationId: string
let team1Id: string
let team2Id: string
let userId: string
let organizationMembershipId: string

describe('team_members — multi-équipe simultané, sans réécriture croisée', () => {
  beforeAll(async () => {
    const db = createAdminClient()
    const { data: organization, error: organizationError } = await db
      .from('organizations')
      .select('id')
      .eq('slug', 'agp')
      .single()
    if (organizationError) throw organizationError
    organizationId = organization.id

    const { data: created, error: userError } = await db.auth.admin.createUser({
      email: TEST_USER_EMAIL,
      password: 'TestMultiTeam!2026',
      email_confirm: true,
      user_metadata: { full_name: 'Test Multi Team' },
    })
    if (userError) throw userError
    userId = created.user!.id

    const { data: membership, error: membershipError } = await db
      .from('organization_memberships')
      .insert({ user_id: userId, organization_id: organizationId, role: 'chef_equipe', status: 'active' })
      .select('id')
      .single()
    if (membershipError) throw membershipError
    organizationMembershipId = membership.id

    const { data: t1, error: t1Error } = await db
      .from('teams')
      .insert({ name: TEST_TEAM_NAME_1, organization_id: organizationId })
      .select('id')
      .single()
    if (t1Error) throw t1Error
    team1Id = t1.id

    const { data: t2, error: t2Error } = await db
      .from('teams')
      .insert({ name: TEST_TEAM_NAME_2, organization_id: organizationId })
      .select('id')
      .single()
    if (t2Error) throw t2Error
    team2Id = t2.id
  })

  afterAll(async () => {
    const db = createAdminClient()
    if (team1Id) await db.from('teams').delete().eq('id', team1Id)
    if (team2Id) await db.from('teams').delete().eq('id', team2Id)
    if (organizationMembershipId) {
      await db.from('organization_memberships').delete().eq('id', organizationMembershipId)
    }
    if (userId) await db.auth.admin.deleteUser(userId)
  })

  it('une même personne appartient à 2 équipes en même temps — aucune exclusivité', async () => {
    await addMemberToTeam(team1Id, userId)
    await addMemberToTeam(team2Id, userId)

    const activeTeamIds = await listActiveTeamIdsForUser(userId)
    expect(activeTeamIds).toEqual(expect.arrayContaining([team1Id, team2Id]))
    expect(activeTeamIds).toHaveLength(2)
  })

  it('rejoindre une équipe n’invente AUCUN historique — 0 ligne intervention_participants créée', async () => {
    // addMemberToTeam n'écrit QUE dans team_members (cf. lib/db/teams.ts) :
    // appartenir à une équipe ne fabrique jamais une participation passée.
    const db = createAdminClient()
    const { data: participations, error } = await db
      .from('intervention_participants')
      .select('intervention_id')
      .eq('user_id', userId)
    if (error) throw error
    expect(participations ?? []).toHaveLength(0)
  })

  it('quitter une équipe ne touche PAS l’appartenance à l’autre (pas de réécriture croisée)', async () => {
    const db = createAdminClient()
    const { data: rowBefore } = await db
      .from('team_members')
      .select('id, left_at, joined_at')
      .eq('team_id', team2Id)
      .eq('user_id', userId)
      .single()
    expect(rowBefore!.left_at).toBeNull()

    await removeMemberFromTeam(team1Id, userId)

    const activeTeamIds = await listActiveTeamIdsForUser(userId)
    expect(activeTeamIds).toEqual([team2Id])

    const { data: team2RowAfter } = await db
      .from('team_members')
      .select('id, left_at, joined_at')
      .eq('id', rowBefore!.id)
      .single()
    // L'équipe 2 n'a pas bougé : même ligne, même joined_at, toujours active.
    expect(team2RowAfter!.left_at).toBeNull()
    expect(team2RowAfter!.joined_at).toBe(rowBefore!.joined_at)

    const { data: team1RowAfter } = await db
      .from('team_members')
      .select('left_at')
      .eq('team_id', team1Id)
      .eq('user_id', userId)
      .single()
    // Quitter = left_at, jamais une suppression de la ligne.
    expect(team1RowAfter!.left_at).not.toBeNull()
  })
})
