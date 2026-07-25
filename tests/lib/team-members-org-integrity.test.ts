import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

const TEST_TEAM_NAME = `__test_team_org_integrity_${Date.now()}`
const TEST_USER_EMAIL = `__test_team_org_integrity_${Date.now()}@example.test`

let organizationId: string
let teamId: string
let userId: string
let organizationMembershipId: string

describe('team_members organization integrity — migration 237', () => {
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
      password: 'TestTeamOrgIntegrity!2026',
      email_confirm: true,
      user_metadata: { full_name: 'Test Team Org Integrity' },
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

    const { data: team, error: teamError } = await db
      .from('teams')
      .insert({ name: TEST_TEAM_NAME, organization_id: organizationId })
      .select('id')
      .single()
    if (teamError) throw teamError
    teamId = team.id
  })

  afterAll(async () => {
    const db = createAdminClient()
    if (teamId) await db.from('teams').delete().eq('id', teamId)
    if (organizationMembershipId) {
      await db.from('organization_memberships').delete().eq('id', organizationMembershipId)
    }
    if (userId) await db.auth.admin.deleteUser(userId)
  })

  it('requires the target user to have an active organization membership', async () => {
    const db = createAdminClient()
    const { data: fred } = await db
      .from('users')
      .select('id')
      .eq('email', 'chef.batisud@memoria.nc')
      .single()

    const { error } = await db
      .from('team_members')
      .insert({ team_id: teamId, user_id: fred!.id, organization_id: organizationId })

    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/active organization membership|team_member/i)
  })

  it('closes active team memberships when organization access is suspended', async () => {
    const db = createAdminClient()
    const { data: member, error: memberError } = await db
      .from('team_members')
      .insert({ team_id: teamId, user_id: userId, organization_id: organizationId })
      .select('id, left_at')
      .single()
    expect(memberError).toBeNull()
    expect(member!.left_at).toBeNull()

    const { error: suspendError } = await db
      .from('organization_memberships')
      .update({ status: 'suspended' })
      .eq('id', organizationMembershipId)
    expect(suspendError).toBeNull()

    const { data: archived } = await db
      .from('team_members')
      .select('left_at')
      .eq('id', member!.id)
      .single()
    expect(archived!.left_at).not.toBeNull()

    const { error: reactivateError } = await db
      .from('organization_memberships')
      .update({ status: 'active' })
      .eq('id', organizationMembershipId)
    expect(reactivateError).toBeNull()

    const { data: remainsArchived } = await db
      .from('team_members')
      .select('left_at')
      .eq('id', member!.id)
      .single()
    expect(remainsArchived!.left_at).not.toBeNull()
  })
})
