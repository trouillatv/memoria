import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  createTeam,
  updateTeam,
  archiveTeam,
  addMemberToTeam,
  removeMemberFromTeam,
  listActiveTeamIdsForUser,
  listOrphanUsers,
  listTeamsWithMemberCount,
  listMembersOfTeam,
} from '@/lib/db/teams'

// Slice 9.1 — Tests helpers DB `lib/db/teams.ts`.
//
// Doctrine V2 :
//   - archiveTeam soft-delete + désaffecte UNIQUEMENT les interventions
//     planifiées (statuts in_progress/completed/validated/skipped conservent
//     leur assigned_team_id pour l'immuabilité de la preuve).
//   - member_count descriptif, jamais analytique.
//   - listOrphanUsers : chef_equipe sans équipe (pour bandeau page Équipes).

const TEST_TENDER_TITLE = '__test_phase9_teams_helpers_tender__'
const TEST_CLIENT_NAME = '__test_phase9_teams_helpers_client__'
const TEST_USER_EMAIL_PREFIX = '__test_phase9_teams_helpers_user_'

let tenderId: string
let contractId: string
let clientId: string
let siteId: string
let missionId: string
let testUserId: string
let testUserEmail: string

async function setupTestData() {
  const supabase = createAdminClient()
  const { data: admin } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!admin) throw new Error('No admin user')

  const { data: existingTender } = await supabase
    .from('tenders')
    .select('id')
    .eq('title', TEST_TENDER_TITLE)
    .maybeSingle()
  if (existingTender) {
    tenderId = existingTender.id
  } else {
    const { data, error } = await supabase
      .from('tenders')
      .insert({ title: TEST_TENDER_TITLE, status: 'ready', created_by: admin.id })
      .select('id')
      .single()
    if (error) throw error
    tenderId = data.id
  }

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('name', TEST_CLIENT_NAME)
    .maybeSingle()
  if (existingClient) {
    clientId = existingClient.id
  } else {
    const { data, error } = await supabase
      .from('clients')
      .insert({ name: TEST_CLIENT_NAME })
      .select('id')
      .single()
    if (error) throw error
    clientId = data.id
  }

  contractId = await createContract({
    tender_id: tenderId,
    name: '__test_contract_phase9_teams_helpers__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'Test Site Teams Helpers',
  })
  missionId = await createMission({
    site_id: siteId,
    name: 'Mission test helpers équipe',
    cadence: 'daily',
    created_by: null,
  })

  // User test (chef_equipe pour ne pas polluer admins/managers)
  testUserEmail = `${TEST_USER_EMAIL_PREFIX}${Date.now()}@example.test`
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: testUserEmail,
    password: 'TestPhase9TeamsHelpers!2026',
    email_confirm: true,
    user_metadata: { full_name: 'Test Helpers Teams' },
  })
  if (createErr) throw createErr
  if (!created.user) throw new Error('No user returned')
  testUserId = created.user.id

  await supabase
    .from('users')
    .update({ role: 'chef_equipe', full_name: 'Test Helpers Teams' })
    .eq('id', testUserId)
}

async function cleanupTeams() {
  const supabase = createAdminClient()
  // Désaffecter mission/interventions de notre site avant purge teams
  await supabase.from('interventions').update({ assigned_team_id: null }).eq('mission_id', missionId)
  await supabase.from('missions').update({ assigned_team_id: null }).eq('id', missionId)
  // Hard delete les équipes de test (et leurs interventions de test)
  await supabase.from('interventions').delete().eq('mission_id', missionId)
  await supabase.from('teams').delete().like('name', '\\_\\_test\\_phase9\\_helpers\\_%')
}

async function cleanupAll() {
  const supabase = createAdminClient()
  await supabase.from('interventions').update({ assigned_team_id: null }).eq('mission_id', missionId)
  await supabase.from('missions').update({ assigned_team_id: null }).eq('site_id', siteId)
  await cleanupTeams()

  const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
  if (sites && sites.length > 0) {
    await supabase.from('missions').delete().in('site_id', sites.map((s) => s.id))
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
  if (testUserId) {
    await supabase.auth.admin.deleteUser(testUserId)
  }
}

describe('lib/db/teams.ts — Slice 9.1', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    await cleanupTeams()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  // ===========================================================
  // 1. createTeam valide
  // ===========================================================
  it('createTeam valide avec name + color → team active par défaut', async () => {
    const t = await createTeam({ name: '__test_phase9_helpers_Alpha', color: '#aabbcc' })
    expect(t.id).toBeTruthy()
    expect(t.name).toBe('__test_phase9_helpers_Alpha')
    expect(t.color).toBe('#aabbcc')
    expect(t.active).toBe(true)
    expect(t.deleted_at).toBeNull()
  })

  // ===========================================================
  // 2. updateTeam active=false
  // ===========================================================
  it('updateTeam active=false → équipe désactivée (mais non archivée)', async () => {
    const t = await createTeam({ name: '__test_phase9_helpers_Beta' })
    const upd = await updateTeam(t.id, { active: false })
    expect(upd.active).toBe(false)
    expect(upd.deleted_at).toBeNull() // pas archivée, juste désactivée
    expect(upd.name).toBe('__test_phase9_helpers_Beta')
  })

  // ===========================================================
  // 3. archiveTeam désaffecte planned + conserve completed
  // ===========================================================
  it('archiveTeam désaffecte planned, CONSERVE assigned_team_id sur completed (preuve)', async () => {
    const supabase = createAdminClient()
    const t = await createTeam({ name: '__test_phase9_helpers_Gamma' })

    // 2 interventions : 1 planned, 1 completed — toutes 2 assignées à Gamma
    const { data: ivPlanned, error: e1 } = await supabase
      .from('interventions')
      .insert({
        mission_id: missionId,
        scheduled_at: '2026-05-20T08:00:00.000Z',
        scheduled_for: '2026-05-20',
        slot: 'morning',
        status: 'planned',
        assigned_team_id: t.id,
      })
      .select('id')
      .single()
    expect(e1).toBeNull()

    const { data: ivCompleted, error: e2 } = await supabase
      .from('interventions')
      .insert({
        mission_id: missionId,
        scheduled_at: '2026-05-01T08:00:00.000Z',
        scheduled_for: '2026-05-01',
        slot: 'morning',
        status: 'completed',
        assigned_team_id: t.id,
        executed_at: '2026-05-01T10:00:00.000Z',
      })
      .select('id')
      .single()
    expect(e2).toBeNull()

    // Mission assignée à Gamma aussi
    await supabase.from('missions').update({ assigned_team_id: t.id }).eq('id', missionId)

    // Archive
    await archiveTeam(t.id)

    // L'équipe est soft-deleted + active=false
    const { data: tAfter } = await supabase
      .from('teams')
      .select('deleted_at, active')
      .eq('id', t.id)
      .maybeSingle()
    expect(tAfter!.deleted_at).not.toBeNull()
    expect(tAfter!.active).toBe(false)

    // Intervention planned → désaffectée
    const { data: planAfter } = await supabase
      .from('interventions')
      .select('assigned_team_id')
      .eq('id', ivPlanned!.id)
      .single()
    expect(planAfter!.assigned_team_id).toBeNull()

    // Intervention completed → assigned_team_id CONSERVÉ (immuabilité preuve)
    const { data: compAfter } = await supabase
      .from('interventions')
      .select('assigned_team_id')
      .eq('id', ivCompleted!.id)
      .single()
    expect(compAfter!.assigned_team_id).toBe(t.id)

    // Mission désaffectée
    const { data: mAfter } = await supabase
      .from('missions')
      .select('assigned_team_id')
      .eq('id', missionId)
      .single()
    expect(mAfter!.assigned_team_id).toBeNull()
  })

  // ===========================================================
  // 4. addMemberToTeam + removeMemberFromTeam (left_at)
  // ===========================================================
  it('addMemberToTeam puis removeMemberFromTeam → left_at NOT NULL', async () => {
    const supabase = createAdminClient()
    const t = await createTeam({ name: '__test_phase9_helpers_Delta' })

    const m = await addMemberToTeam(t.id, testUserId)
    expect(m.team_id).toBe(t.id)
    expect(m.user_id).toBe(testUserId)
    expect(m.left_at).toBeNull()

    await removeMemberFromTeam(t.id, testUserId)

    const { data: after } = await supabase
      .from('team_members')
      .select('left_at')
      .eq('id', m.id)
      .single()
    expect(after!.left_at).not.toBeNull()

    // Idempotent : appeler à nouveau ne casse pas
    await expect(removeMemberFromTeam(t.id, testUserId)).resolves.toBeUndefined()
  })

  // ===========================================================
  // 5. listActiveTeamIdsForUser filtre left_at
  // ===========================================================
  it('listActiveTeamIdsForUser : filtre les memberships terminés (left_at NOT NULL)', async () => {
    const t1 = await createTeam({ name: '__test_phase9_helpers_Epsilon' })
    const t2 = await createTeam({ name: '__test_phase9_helpers_Zeta' })

    await addMemberToTeam(t1.id, testUserId)
    await addMemberToTeam(t2.id, testUserId)

    let ids = await listActiveTeamIdsForUser(testUserId)
    expect(ids.sort()).toEqual([t1.id, t2.id].sort())

    // Retire de t1
    await removeMemberFromTeam(t1.id, testUserId)
    ids = await listActiveTeamIdsForUser(testUserId)
    expect(ids).toEqual([t2.id])

    // Retire de t2
    await removeMemberFromTeam(t2.id, testUserId)
    ids = await listActiveTeamIdsForUser(testUserId)
    expect(ids).toEqual([])
  })

  // ===========================================================
  // 6. listOrphanUsers — chef_equipe sans équipe
  // ===========================================================
  it('listOrphanUsers : retourne testUser tant qu\'il n\'est dans aucune équipe', async () => {
    const orphans = await listOrphanUsers()
    const ourUser = orphans.find((u) => u.id === testUserId)
    expect(ourUser).toBeDefined()
    expect(ourUser!.role).toBe('chef_equipe')

    // Une fois affecté à une équipe, il disparaît de la liste
    const t = await createTeam({ name: '__test_phase9_helpers_Eta' })
    await addMemberToTeam(t.id, testUserId)

    const orphansAfter = await listOrphanUsers()
    expect(orphansAfter.find((u) => u.id === testUserId)).toBeUndefined()
  })

  // ===========================================================
  // 7. listTeamsWithMemberCount
  // ===========================================================
  it('listTeamsWithMemberCount : compte les memberships actifs (left_at IS NULL)', async () => {
    const a = await createTeam({ name: '__test_phase9_helpers_Alpha2' })
    const b = await createTeam({ name: '__test_phase9_helpers_Beta2' })

    await addMemberToTeam(a.id, testUserId)

    const teams = await listTeamsWithMemberCount()
    const ourA = teams.find((t) => t.id === a.id)
    const ourB = teams.find((t) => t.id === b.id)
    expect(ourA).toBeDefined()
    expect(ourB).toBeDefined()
    expect(ourA!.memberCount).toBe(1)
    expect(ourB!.memberCount).toBe(0)

    // listMembersOfTeam reflète le membership actif
    const members = await listMembersOfTeam(a.id)
    expect(members).toHaveLength(1)
    expect(members[0].user.id).toBe(testUserId)

    // Retirer → memberCount retombe à 0
    await removeMemberFromTeam(a.id, testUserId)
    const teamsAfter = await listTeamsWithMemberCount()
    expect(teamsAfter.find((t) => t.id === a.id)!.memberCount).toBe(0)
  })
})
