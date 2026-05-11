import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'

// Slice 9.0 — Migration DB teams + team_members + assigned_team_id.
// Tests directs (DB réelle, createAdminClient) sur les contraintes critiques
// de la migration 023 :
//   - teams : CHECK length, UNIQUE name actif case-insensitive, soft-delete
//   - team_members : UNIQUE actif (team_id, user_id), CASCADE ON DELETE
//   - missions.assigned_team_id + interventions.assigned_team_id : SET NULL
// Doctrine V2 : aucune écriture liée à assigned_to_user_id, score, capacity.

const TEST_TENDER_TITLE = '__test_phase9_teams_tender__'
const TEST_CLIENT_NAME = '__test_phase9_teams_client__'
const TEST_USER_EMAIL = `__test_phase9_teams_user_${Date.now()}@example.test`

let tenderId: string
let contractId: string
let clientId: string
let siteId: string
let missionId: string
let testUserId: string

async function setupTestData() {
  const supabase = createAdminClient()

  // Find existing admin (we need one to satisfy created_by FK if needed)
  const { data: admin } = await supabase.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('No admin user')

  // Tender (idempotent)
  const { data: existingTender } = await supabase.from('tenders').select('id').eq('title', TEST_TENDER_TITLE).maybeSingle()
  if (existingTender) {
    tenderId = existingTender.id
  } else {
    const { data, error } = await supabase.from('tenders').insert({
      title: TEST_TENDER_TITLE, status: 'ready', created_by: admin.id,
    }).select('id').single()
    if (error) throw error
    tenderId = data.id
  }

  // Client (idempotent)
  const { data: existingClient } = await supabase.from('clients').select('id').eq('name', TEST_CLIENT_NAME).maybeSingle()
  if (existingClient) {
    clientId = existingClient.id
  } else {
    const { data, error } = await supabase.from('clients').insert({ name: TEST_CLIENT_NAME }).select('id').single()
    if (error) throw error
    clientId = data.id
  }

  // Contract (one per run)
  contractId = await createContract({
    tender_id: tenderId,
    name: '__test_contract_phase9_teams__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  // Site + mission (mission est nécessaire pour le test SET NULL côté missions)
  siteId = await createSite({ client_id: clientId, contract_id: contractId, name: 'Test Site Teams' })
  missionId = await createMission({
    site_id: siteId,
    name: 'Mission test affectation équipe',
    cadence: 'daily',
    created_by: null,
  })

  // Création d'un user auth dédié pour les tests team_members
  // (FK team_members.user_id → public.users.id → auth.users.id)
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: TEST_USER_EMAIL,
    password: 'TestPhase9Teams!2026',
    email_confirm: true,
    user_metadata: { full_name: 'Test Phase 9 Teams User' },
  })
  if (createErr) throw createErr
  if (!created.user) throw new Error('No user returned')
  testUserId = created.user.id

  // Le trigger on_auth_user_created crée public.users — on force chef_equipe pour
  // ne pas polluer la liste admins/managers.
  await supabase.from('users').update({ role: 'chef_equipe', full_name: 'Test Teams' }).eq('id', testUserId)
}

async function cleanupTeams() {
  const supabase = createAdminClient()
  // Supprime toutes les équipes de test (cascade → team_members).
  // Notre seul critère fiable : les noms qu'on a créés dans les tests.
  // Pour rester simple : on purge toutes les équipes créées par nos tests via like.
  await supabase.from('teams').delete().like('name', '\\_\\_test\\_phase9\\_%')
}

async function cleanupAll() {
  const supabase = createAdminClient()

  // Désaffecter les missions / interventions de notre site avant de purger les teams
  await supabase.from('interventions').update({ assigned_team_id: null }).eq('mission_id', missionId)
  await supabase.from('missions').update({ assigned_team_id: null }).eq('site_id', siteId)

  await cleanupTeams()

  const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
  if (sites && sites.length > 0) {
    // Interventions seront cascade par missions, missions cascade par sites
    await supabase.from('missions').delete().in('site_id', sites.map((s) => s.id))
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)

  // Drop l'utilisateur auth de test (cascade → public.users → team_members)
  if (testUserId) {
    await supabase.auth.admin.deleteUser(testUserId)
  }
}

describe('teams + team_members + assigned_team_id DB — Slice 9.0', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    await cleanupTeams()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  // ============================================================
  // 1. Insertion team valide
  // ============================================================
  it('insère une team valide avec defaults (active=true, color=null, deleted_at=null)', async () => {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('teams')
      .insert({ name: '__test_phase9_Alpha' })
      .select('*')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.name).toBe('__test_phase9_Alpha')
    expect(data!.color).toBeNull()
    expect(data!.active).toBe(true)
    expect(data!.deleted_at).toBeNull()
    expect(data!.created_at).toBeTruthy()
  })

  // ============================================================
  // 2. Contrainte name trop long (> 50 chars)
  // ============================================================
  it('rejette une team dont le name dépasse 50 caractères (chk_team_name_length)', async () => {
    const supabase = createAdminClient()
    const longName = '__test_phase9_' + 'a'.repeat(60)
    const { error } = await supabase
      .from('teams')
      .insert({ name: longName })

    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/chk_team_name_length|check/)
  })

  // ============================================================
  // 3. Contrainte name vide après trim
  // ============================================================
  it('rejette une team dont le name est vide après trim (chk_team_name_length)', async () => {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('teams')
      .insert({ name: '   ' })

    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/chk_team_name_length|check/)
  })

  // ============================================================
  // 4. Unicité name actif (case-insensitive)
  // ============================================================
  it('rejette une 2e team avec le même name (case-insensitive, deleted_at IS NULL)', async () => {
    const supabase = createAdminClient()
    const { error: e1 } = await supabase.from('teams').insert({ name: '__test_phase9_Alpha' })
    expect(e1).toBeNull()

    // Même casse → ERROR
    const { error: e2 } = await supabase.from('teams').insert({ name: '__test_phase9_Alpha' })
    expect(e2).not.toBeNull()
    expect(e2!.message.toLowerCase()).toMatch(/duplicate|unique|idx_teams_name_active/)

    // Casse différente → également ERROR (lower(name))
    const { error: e3 } = await supabase.from('teams').insert({ name: '__test_phase9_alpha' })
    expect(e3).not.toBeNull()
    expect(e3!.message.toLowerCase()).toMatch(/duplicate|unique|idx_teams_name_active/)
  })

  // ============================================================
  // 5. Re-création après soft-delete (deleted_at NOT NULL)
  // ============================================================
  it('permet de re-créer une team avec le même name après soft-delete', async () => {
    const supabase = createAdminClient()
    const { data: t1, error: e1 } = await supabase
      .from('teams')
      .insert({ name: '__test_phase9_Alpha' })
      .select('id')
      .single()
    expect(e1).toBeNull()

    // Soft-delete
    const { error: eDel } = await supabase
      .from('teams')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', t1!.id)
    expect(eDel).toBeNull()

    // Re-create avec même nom → succès car index partial WHERE deleted_at IS NULL
    const { error: e2 } = await supabase.from('teams').insert({ name: '__test_phase9_Alpha' })
    expect(e2).toBeNull()
  })

  // ============================================================
  // 6. team_members — insertion valide
  // ============================================================
  it('insère un team_member valide (team + user existants) avec left_at NULL', async () => {
    const supabase = createAdminClient()
    const { data: team } = await supabase
      .from('teams')
      .insert({ name: '__test_phase9_Beta' })
      .select('id')
      .single()

    const { data: member, error } = await supabase
      .from('team_members')
      .insert({ team_id: team!.id, user_id: testUserId })
      .select('*')
      .single()

    expect(error).toBeNull()
    expect(member).not.toBeNull()
    expect(member!.team_id).toBe(team!.id)
    expect(member!.user_id).toBe(testUserId)
    expect(member!.left_at).toBeNull()
    expect(member!.joined_at).toBeTruthy()
  })

  // ============================================================
  // 7. UNIQUE actif (team_id, user_id) WHERE left_at IS NULL
  // ============================================================
  it('rejette un 2e membership actif pour le même (team_id, user_id)', async () => {
    const supabase = createAdminClient()
    const { data: team } = await supabase
      .from('teams')
      .insert({ name: '__test_phase9_Gamma' })
      .select('id')
      .single()

    const { error: e1 } = await supabase
      .from('team_members')
      .insert({ team_id: team!.id, user_id: testUserId })
    expect(e1).toBeNull()

    const { error: e2 } = await supabase
      .from('team_members')
      .insert({ team_id: team!.id, user_id: testUserId })
    expect(e2).not.toBeNull()
    expect(e2!.message.toLowerCase()).toMatch(/duplicate|unique|idx_team_members_active_unique/)
  })

  // ============================================================
  // 8. Re-rejoindre après left (left_at NOT NULL)
  // ============================================================
  it('permet de re-rejoindre une équipe après avoir quitté (left_at NOT NULL)', async () => {
    const supabase = createAdminClient()
    const { data: team } = await supabase
      .from('teams')
      .insert({ name: '__test_phase9_Delta' })
      .select('id')
      .single()

    const { data: m1, error: e1 } = await supabase
      .from('team_members')
      .insert({ team_id: team!.id, user_id: testUserId })
      .select('id')
      .single()
    expect(e1).toBeNull()

    // Quitter
    const { error: eLeft } = await supabase
      .from('team_members')
      .update({ left_at: new Date().toISOString() })
      .eq('id', m1!.id)
    expect(eLeft).toBeNull()

    // Re-rejoindre → succès car UNIQUE partial WHERE left_at IS NULL
    const { error: e2 } = await supabase
      .from('team_members')
      .insert({ team_id: team!.id, user_id: testUserId })
    expect(e2).toBeNull()
  })

  // ============================================================
  // 9. ON DELETE team → CASCADE team_members
  // ============================================================
  it('CASCADE supprime les team_members quand la team est DELETE', async () => {
    const supabase = createAdminClient()
    const { data: team } = await supabase
      .from('teams')
      .insert({ name: '__test_phase9_Epsilon' })
      .select('id')
      .single()

    await supabase
      .from('team_members')
      .insert({ team_id: team!.id, user_id: testUserId })

    // Hard delete team
    const { error: delErr } = await supabase.from('teams').delete().eq('id', team!.id)
    expect(delErr).toBeNull()

    const { data: stillMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', team!.id)
      .maybeSingle()
    expect(stillMember).toBeNull()
  })

  // ============================================================
  // 10. ON DELETE team → SET NULL sur missions.assigned_team_id
  // ============================================================
  it('SET NULL sur missions/interventions.assigned_team_id quand la team est DELETE', async () => {
    const supabase = createAdminClient()
    const { data: team } = await supabase
      .from('teams')
      .insert({ name: '__test_phase9_Zeta' })
      .select('id')
      .single()

    // Assigner mission
    const { error: eUpdM } = await supabase
      .from('missions')
      .update({ assigned_team_id: team!.id })
      .eq('id', missionId)
    expect(eUpdM).toBeNull()

    // Créer une intervention liée et l'assigner
    const { data: iv, error: eIv } = await supabase
      .from('interventions')
      .insert({
        mission_id: missionId,
        scheduled_at: '2026-05-15T08:00:00.000Z',
        assigned_team_id: team!.id,
      })
      .select('id')
      .single()
    expect(eIv).toBeNull()

    // Hard delete team
    const { error: delErr } = await supabase.from('teams').delete().eq('id', team!.id)
    expect(delErr).toBeNull()

    // Mission désaffectée
    const { data: mAfter } = await supabase
      .from('missions')
      .select('assigned_team_id')
      .eq('id', missionId)
      .single()
    expect(mAfter!.assigned_team_id).toBeNull()

    // Intervention désaffectée
    const { data: iAfter } = await supabase
      .from('interventions')
      .select('assigned_team_id')
      .eq('id', iv!.id)
      .single()
    expect(iAfter!.assigned_team_id).toBeNull()

    // Cleanup intervention
    await supabase.from('interventions').delete().eq('id', iv!.id)
  })

  // ============================================================
  // 11. ON DELETE user → CASCADE team_members
  // ============================================================
  it('CASCADE supprime team_members quand le user est DELETE', async () => {
    const supabase = createAdminClient()

    // Créer un user éphémère dédié (on ne veut pas casser testUserId)
    const ephemeralEmail = `__test_phase9_ephemeral_${Date.now()}@example.test`
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: ephemeralEmail,
      password: 'EphemeralPhase9!2026',
      email_confirm: true,
    })
    expect(createErr).toBeNull()
    const ephemeralUserId = created!.user!.id

    const { data: team } = await supabase
      .from('teams')
      .insert({ name: '__test_phase9_Eta' })
      .select('id')
      .single()

    const { data: m, error: eIns } = await supabase
      .from('team_members')
      .insert({ team_id: team!.id, user_id: ephemeralUserId })
      .select('id')
      .single()
    expect(eIns).toBeNull()
    const membershipId = m!.id

    // Hard delete user via auth.admin (cascade auth.users → public.users → team_members)
    const { error: delErr } = await supabase.auth.admin.deleteUser(ephemeralUserId)
    expect(delErr).toBeNull()

    const { data: stillMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('id', membershipId)
      .maybeSingle()
    expect(stillMember).toBeNull()
  })
})
