/**
 * scripts/phase9-smoke.ts
 *
 * Smoke test programmatique de la Phase 9 — Vue Semaine & Équipes.
 *
 * Couvre les invariants doctrine V2 critiques :
 *
 *   1. createTeam → row + UNIQUE name actif (insertion d'un doublon refusée)
 *   2. addMemberToTeam → membership active visible
 *   3. removeMemberFromTeam → left_at NOT NULL (historique conservé)
 *   4. archiveTeam → soft-delete + désaffectation des interventions PLANIFIÉES
 *      uniquement (les `completed`/`validated` CONSERVENT `assigned_team_id`
 *      pour immuabilité de la preuve)
 *   5. getWeekBySite ↔ getWeekByTeam : pour la même semaine, le total
 *      d'interventions est identique entre les deux agrégations
 *   6. Mutations DB (équivalent moveInterventionToDayAction +
 *      reassignInterventionTeamAction) : replanif + reassign d'une intervention
 *      `planned` réussissent. Les server actions elles-mêmes requièrent un
 *      contexte d'auth utilisateur → on couvre via `tests/lib/reassign-actions.test.ts`
 *      (vitest). Ici on vérifie les invariants DB.
 *
 * Cleanup : toutes les rows de test sont préfixées `__phase9_smoke_` et
 * supprimées à la fin (try/finally), même en cas d'échec.
 *
 * Usage : `npx tsx scripts/phase9-smoke.ts`
 *
 * Critère de succès : tous les asserts passent. Sinon, exit 1.
 */
import * as fs from 'fs'

// Node 20 lacks native WebSocket — Supabase realtime client requires it.
 
const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

import { createAdminClient } from '@/lib/supabase/admin'
import {
  createTeam,
  archiveTeam,
  addMemberToTeam,
  removeMemberFromTeam,
  listTeamsWithMemberCount,
} from '@/lib/db/teams'
import {
  getWeekRange,
  getWeekBySite,
  getWeekByTeam,
} from '@/lib/db/week-planning'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

const SMOKE_PREFIX = '__phase9_smoke_'
const TEAM_A_NAME = `${SMOKE_PREFIX}alpha_${Date.now()}`
const TEAM_B_NAME = `${SMOKE_PREFIX}beta_${Date.now()}`
const TENDER_TITLE = `${SMOKE_PREFIX}tender_${Date.now()}`
const CLIENT_NAME = `${SMOKE_PREFIX}client_${Date.now()}`
const SITE_NAME = `${SMOKE_PREFIX}site_${Date.now()}`
const MISSION_NAME = `${SMOKE_PREFIX}mission_${Date.now()}`

let nbFail = 0
function assert(cond: boolean, label: string): void {
  if (!cond) {
    console.error(`❌ ${label}`)
    nbFail++
    return
  }
  console.log(`  ✓ ${label}`)
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    console.error(`❌ ${label} : expected ${String(expected)}, got ${String(actual)}`)
    nbFail++
    return
  }
  console.log(`  ✓ ${label} = ${String(actual)}`)
}

function ymdOffset(offsetDays: number): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

async function findAdmin(supabase: SupabaseAdmin): Promise<string> {
  const { data: admin, error } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!admin) throw new Error('No admin user. Run db:bootstrap-admin first.')
  return admin.id as string
}

async function findChefEquipe(supabase: SupabaseAdmin): Promise<string | null> {
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'chef_equipe')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

interface SetupFixture {
  tenderId: string
  contractId: string
  clientId: string
  siteId: string
  missionId: string
  plannedInterventionId: string
  completedInterventionId: string
  weekDate: string
}

async function setupFixture(
  supabase: SupabaseAdmin,
  adminId: string
): Promise<SetupFixture> {
  // Cleanup éventuel d'un run précédent (idempotence du smoke lui-même)
  await cleanupFixture(supabase)

  // Tender
  const { data: tender, error: tErr } = await supabase
    .from('tenders')
    .insert({ title: TENDER_TITLE, status: 'ready', created_by: adminId })
    .select('id')
    .single()
  if (tErr) throw tErr
  const tenderId = tender.id as string

  // Client (pas de colonne created_by sur clients — cf. migration 003)
  const { data: client, error: cErr } = await supabase
    .from('clients')
    .insert({ name: CLIENT_NAME })
    .select('id')
    .single()
  if (cErr) throw cErr
  const clientId = client.id as string

  // Contract
  const { data: contract, error: kErr } = await supabase
    .from('contracts')
    .insert({
      tender_id: tenderId,
      name: `${SMOKE_PREFIX}contract`,
      client_name: CLIENT_NAME,
      start_date: ymdOffset(-30),
      end_date: ymdOffset(365),
      created_by: adminId,
    })
    .select('id')
    .single()
  if (kErr) throw kErr
  const contractId = contract.id as string

  // Site
  const { data: site, error: sErr } = await supabase
    .from('sites')
    .insert({
      client_id: clientId,
      contract_id: contractId,
      name: SITE_NAME,
      address: 'smoke test',
    })
    .select('id')
    .single()
  if (sErr) throw sErr
  const siteId = site.id as string

  // Mission (note: la colonne est `default_team` côté DB, cf. migration 018)
  const { data: mission, error: mErr } = await supabase
    .from('missions')
    .insert({
      site_id: siteId,
      name: MISSION_NAME,
      description: 'smoke test',
      cadence: 'daily',
      default_team: [],
      created_by: adminId,
    })
    .select('id')
    .single()
  if (mErr) throw mErr
  const missionId = mission.id as string

  // Une intervention "planned" cette semaine
  const weekDate = ymdOffset(0)
  const { data: planned, error: pErr } = await supabase
    .from('interventions')
    .insert({
      mission_id: missionId,
      scheduled_at: `${weekDate}T08:00:00.000Z`,
      scheduled_for: weekDate,
      slot: 'morning',
      status: 'planned',
      team: [],
      created_by: adminId,
    })
    .select('id')
    .single()
  if (pErr) throw pErr

  // Une intervention "completed" la même semaine
  const { data: completed, error: cmpErr } = await supabase
    .from('interventions')
    .insert({
      mission_id: missionId,
      scheduled_at: `${weekDate}T14:00:00.000Z`,
      scheduled_for: weekDate,
      slot: 'afternoon',
      status: 'completed',
      team: [],
      created_by: adminId,
    })
    .select('id')
    .single()
  if (cmpErr) throw cmpErr

  return {
    tenderId,
    contractId,
    clientId,
    siteId,
    missionId,
    plannedInterventionId: planned.id as string,
    completedInterventionId: completed.id as string,
    weekDate,
  }
}

async function cleanupFixture(supabase: SupabaseAdmin): Promise<void> {
  // Hard-delete : on supprime nos artefacts. L'ordre respecte les FK
  // (interventions → missions → sites → contracts → clients/tenders).
  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .like('name', `${SMOKE_PREFIX}%`)
  const missionIds = (missions ?? []).map((m) => m.id as string)
  if (missionIds.length > 0) {
    await supabase.from('interventions').delete().in('mission_id', missionIds)
    await supabase.from('missions').delete().in('id', missionIds)
  }
  await supabase.from('sites').delete().like('name', `${SMOKE_PREFIX}%`)
  await supabase.from('contracts').delete().like('name', `${SMOKE_PREFIX}%`)
  await supabase.from('clients').delete().like('name', `${SMOKE_PREFIX}%`)
  await supabase.from('tenders').delete().like('title', `${SMOKE_PREFIX}%`)
  // Teams : on cible nos préfixes (suppression hard pour cleanup propre — on
  // shunte le soft-delete normalement réservé à l'UX).
  const { data: teams } = await supabase
    .from('teams')
    .select('id')
    .like('name', `${SMOKE_PREFIX}%`)
  const teamIds = (teams ?? []).map((t) => t.id as string)
  if (teamIds.length > 0) {
    await supabase.from('team_members').delete().in('team_id', teamIds)
    await supabase.from('teams').delete().in('id', teamIds)
  }
}

async function main() {
  const supabase = createAdminClient()
  console.log('Phase 9 smoke — start')

  const adminId = await findAdmin(supabase)
  console.log(`Using admin id=${adminId}`)

  const fixture = await setupFixture(supabase, adminId)
  console.log(`Fixture mission=${fixture.missionId} (planned=${fixture.plannedInterventionId}, completed=${fixture.completedInterventionId})`)

  let teamAId: string | null = null
  let teamBId: string | null = null

  try {
    // ----------------------------------------------------------------------
    // 1) createTeam → row + UNIQUE name actif
    // ----------------------------------------------------------------------
    console.log('\nStep 1 — createTeam + UNIQUE name')
    const teamA = await createTeam({ name: TEAM_A_NAME, color: 'sky', created_by: adminId })
    teamAId = teamA.id
    assert(teamA.id.length > 0, 'createTeam returns id')
    assertEq(teamA.name, TEAM_A_NAME, 'team.name correct')
    assertEq(teamA.active, true, 'team.active default true')

    let duplicateBlocked = false
    try {
      await createTeam({ name: TEAM_A_NAME, color: 'red', created_by: adminId })
    } catch {
      duplicateBlocked = true
    }
    assert(duplicateBlocked, 'UNIQUE name actif refuse un doublon')

    // ----------------------------------------------------------------------
    // 2) addMemberToTeam → membership active
    // ----------------------------------------------------------------------
    console.log('\nStep 2 — addMemberToTeam')
    const chefId = (await findChefEquipe(supabase)) ?? adminId
    const membership = await addMemberToTeam(teamA.id, chefId)
    assert(membership.id.length > 0, 'addMemberToTeam returns membership row')
    assertEq(membership.team_id, teamA.id, 'membership.team_id correct')
    assertEq(membership.user_id, chefId, 'membership.user_id correct')
    assertEq(membership.left_at, null, 'membership.left_at is null (active)')

    // listTeamsWithMemberCount doit refléter le compte = 1
    const teamsWithCount = await listTeamsWithMemberCount()
    const aWithCount = teamsWithCount.find((t) => t.id === teamA.id)
    assert(aWithCount !== undefined, 'team A présente dans listTeamsWithMemberCount')
    assertEq(aWithCount?.memberCount ?? -1, 1, 'team A memberCount=1')

    // ----------------------------------------------------------------------
    // 3) removeMemberFromTeam → left_at NOT NULL
    // ----------------------------------------------------------------------
    console.log('\nStep 3 — removeMemberFromTeam')
    await removeMemberFromTeam(teamA.id, chefId)
    const { data: afterLeave } = await supabase
      .from('team_members')
      .select('left_at')
      .eq('id', membership.id)
      .single()
    assert(afterLeave?.left_at !== null && afterLeave?.left_at !== undefined,
      'membership.left_at NOT NULL après removeMemberFromTeam')

    // memberCount retombe à 0
    const afterCount = await listTeamsWithMemberCount()
    const aZero = afterCount.find((t) => t.id === teamA.id)
    assertEq(aZero?.memberCount ?? -1, 0, 'team A memberCount=0 après remove')

    // ----------------------------------------------------------------------
    // 4) archiveTeam → soft-delete + désaffecte planned, conserve completed
    // ----------------------------------------------------------------------
    console.log('\nStep 4 — archiveTeam : désaffecte planned, conserve completed')
    const teamB = await createTeam({ name: TEAM_B_NAME, color: 'emerald', created_by: adminId })
    teamBId = teamB.id

    // Affecter les 2 interventions (planned + completed) à teamB
    await supabase
      .from('interventions')
      .update({ assigned_team_id: teamB.id })
      .in('id', [fixture.plannedInterventionId, fixture.completedInterventionId])

    await archiveTeam(teamB.id)

    // Team soft-deleted (deleted_at NOT NULL, active false)
    const { data: archived } = await supabase
      .from('teams')
      .select('deleted_at, active')
      .eq('id', teamB.id)
      .single()
    assert(archived?.deleted_at !== null, 'team B deleted_at NOT NULL (soft-delete)')
    assertEq(archived?.active, false, 'team B active=false')

    // Intervention planifiée : assigned_team_id désaffecté
    const { data: plannedAfter } = await supabase
      .from('interventions')
      .select('assigned_team_id')
      .eq('id', fixture.plannedInterventionId)
      .single()
    assertEq(plannedAfter?.assigned_team_id, null,
      'intervention planned → assigned_team_id=null après archiveTeam')

    // Intervention complétée : assigned_team_id CONSERVÉ (immuabilité preuve)
    const { data: completedAfter } = await supabase
      .from('interventions')
      .select('assigned_team_id')
      .eq('id', fixture.completedInterventionId)
      .single()
    assertEq(completedAfter?.assigned_team_id, teamB.id,
      'intervention completed → assigned_team_id CONSERVÉ après archiveTeam (immuabilité preuve)')

    // ----------------------------------------------------------------------
    // 5) getWeekBySite ↔ getWeekByTeam : totaux identiques
    // ----------------------------------------------------------------------
    console.log('\nStep 5 — getWeekBySite ↔ getWeekByTeam : totaux cohérents')
    const range = getWeekRange(fixture.weekDate)
    const [bySite, byTeam] = await Promise.all([
      getWeekBySite(range),
      getWeekByTeam(range),
    ])

    const totalSite = bySite.reduce(
      (acc, row) => acc + Object.values(row.days).reduce((a, b) => a + b.length, 0),
      0
    )
    const totalTeam = byTeam.reduce(
      (acc, row) => acc + Object.values(row.days).reduce((a, b) => a + b.length, 0),
      0
    )
    assertEq(totalTeam, totalSite, 'somme(byTeam.days) === somme(bySite.days)')
    assert(totalSite >= 2,
      `total interventions >= 2 (planned + completed du fixture présents) — got ${totalSite}`)

    // ----------------------------------------------------------------------
    // 6) Mutations DB équivalentes aux server actions (move + reassign)
    // ----------------------------------------------------------------------
    // Les server actions elles-mêmes (auth manager+) sont couvertes par
    // tests/lib/reassign-actions.test.ts. Ici on vérifie les invariants DB
    // sur l'intervention planifiée.
    console.log('\nStep 6 — mutations DB (équivalent actions move + reassign)')

    // Replanifier l'intervention planifiée → demain
    const tomorrow = ymdOffset(1)
    const { error: moveErr } = await supabase
      .from('interventions')
      .update({
        scheduled_for: tomorrow,
        scheduled_at: `${tomorrow}T08:00:00.000Z`,
      })
      .eq('id', fixture.plannedInterventionId)
      .eq('status', 'planned')
    assert(!moveErr, 'replanif intervention planned → demain réussit')

    // Recréer une teamA bis temporaire (la précédente a été remove only)
    const teamAReassign = await createTeam({
      name: `${SMOKE_PREFIX}reassign_${Date.now()}`,
      color: 'violet',
      created_by: adminId,
    })

    const { error: reassignErr } = await supabase
      .from('interventions')
      .update({ assigned_team_id: teamAReassign.id })
      .eq('id', fixture.plannedInterventionId)
      .eq('status', 'planned')
    assert(!reassignErr, 'reassign intervention planned → nouvelle équipe réussit')

    const { data: afterReassign } = await supabase
      .from('interventions')
      .select('assigned_team_id, scheduled_for')
      .eq('id', fixture.plannedInterventionId)
      .single()
    assertEq(afterReassign?.assigned_team_id, teamAReassign.id, 'assigned_team_id mis à jour')
    assertEq(afterReassign?.scheduled_for, tomorrow, 'scheduled_for mis à jour')
  } finally {
    // ----------------------------------------------------------------------
    // Cleanup — toujours
    // ----------------------------------------------------------------------
    console.log('\nCleanup ...')
    await cleanupFixture(supabase)
    console.log('  ✓ Cleanup OK')
  }

  console.log('')
  if (nbFail > 0) {
    console.error(`❌ Phase 9 smoke : ${nbFail} assertion(s) failed`)
    process.exit(1)
  }
  console.log('✅ Phase 9 smoke OK :')
  console.log('   - createTeam + UNIQUE name actif')
  console.log('   - addMember/removeMember (left_at gestion)')
  console.log('   - archiveTeam désaffecte planned, conserve completed (preuve)')
  console.log('   - getWeekBySite ↔ getWeekByTeam totaux cohérents')
  console.log('   - mutations DB move/reassign (server actions couvertes par vitest)')
  console.log('   - Cleanup OK')
}

main().catch((e) => {
  console.error('[phase9-smoke] Fatal:', e)
  process.exit(1)
})
