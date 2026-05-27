// Phase 9 — Vue Semaine & Équipes (Slice 9.4)
//
// Tests server actions :
//   - moveInterventionToDayAction
//   - reassignInterventionTeamAction
//
// Stratégie : mocks d'auth (createClient + getUserRoleById) + neutralisation
// revalidatePath. Données réelles en DB (intervention + équipe) pour vérifier
// l'effet de bord.

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import { createIntervention } from '@/lib/db/interventions'
import { createTeam, archiveTeam } from '@/lib/db/teams'

// ---------------------------------------------------------------------------
// Mocks d'auth + revalidatePath (idem stratégie skip-intervention.test.ts)
// ---------------------------------------------------------------------------

// V6.1 : actions.ts importe findTeamSiteConflict qui est en `server-only`.
// Vitest n'utilise pas le path alias de tsconfig ; on le neutralise ici.
vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: globalThis.__REASSIGN_TEST_USER_ID__ ?? 'unset' } },
      })),
    },
  })),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/db/users', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/db/users')>()
  return {
    ...orig,
    getUserRoleById: vi.fn(async () => 'admin' as const),
  }
})

async function importActions() {
  return await import('@/app/(dashboard)/semaine/actions')
}

declare global {
   
  var __REASSIGN_TEST_USER_ID__: string | undefined
}

// ---------------------------------------------------------------------------
// Setup données
// ---------------------------------------------------------------------------

const TEST_TENDER_TITLE = '__test_reassign_phase9_tender__'
const TEST_CLIENT_NAME = '__test_reassign_phase9_client__'
const TEAM_PREFIX = '__test_reassign_phase9_team_'

let tenderId: string
let contractId: string
let clientId: string
let siteId: string
let missionId: string
let adminUserId: string

/** Calcule aujourd'hui + offsetDays en yyyy-mm-dd UTC. */
function ymdOffset(offsetDays: number): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

async function setupTestData() {
  const supabase = createAdminClient()
  const { data: admin } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!admin) throw new Error('No admin user — seed needed')
  adminUserId = admin.id

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
    name: '__test_contract_reassign_phase9__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'Test Site Reassign',
  })
  missionId = await createMission({
    site_id: siteId,
    name: 'Mission reassign test',
    cadence: 'daily',
    created_by: null,
  })
}

async function cleanupAfterEach() {
  const supabase = createAdminClient()
  await supabase.from('interventions').update({ assigned_team_id: null }).eq('mission_id', missionId)
  await supabase.from('interventions').delete().eq('mission_id', missionId)
  await supabase.from('teams').delete().like('name', `${TEAM_PREFIX}%`)
}

async function cleanupAll() {
  const supabase = createAdminClient()
  await cleanupAfterEach()
  const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
  if (sites && sites.length > 0) {
    const siteIds = sites.map((s) => s.id)
    const { data: missions } = await supabase.from('missions').select('id').in('site_id', siteIds)
    if (missions && missions.length > 0) {
      await supabase.from('interventions').delete().in('mission_id', missions.map((m) => m.id))
      await supabase.from('missions').delete().in('site_id', siteIds)
    }
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

// ---------------------------------------------------------------------------
// moveInterventionToDayAction
// ---------------------------------------------------------------------------

describe('moveInterventionToDayAction — Slice 9.4', () => {
  beforeAll(async () => {
    await setupTestData()
    globalThis.__REASSIGN_TEST_USER_ID__ = adminUserId
  })

  afterEach(async () => {
    await cleanupAfterEach()
  })

  afterAll(async () => {
    await cleanupAll()
    globalThis.__REASSIGN_TEST_USER_ID__ = undefined
  })

  it('replanifie une intervention planned vers un nouveau jour futur', async () => {
    const { moveInterventionToDayAction } = await importActions()
    const supabase = createAdminClient()
    const start = ymdOffset(1) // demain
    const target = ymdOffset(3) // dans 3 jours

    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: `${start}T08:00:00.000Z`,
      created_by: null,
    })
    // Aligne scheduled_for sur start (createIntervention pose seulement scheduled_at)
    await supabase.from('interventions').update({ scheduled_for: start }).eq('id', intvId)

    const r = await moveInterventionToDayAction({
      interventionId: intvId,
      newScheduledFor: target,
    })
    expect(r.ok).toBe(true)

    const { data } = await supabase
      .from('interventions')
      .select('scheduled_for, scheduled_at')
      .eq('id', intvId)
      .maybeSingle()
    expect(data!.scheduled_for).toBe(target)
    expect(data!.scheduled_at?.startsWith(target)).toBe(true)
  })

  it('refuse une intervention in_progress (immuabilité preuve)', async () => {
    const { moveInterventionToDayAction } = await importActions()
    const supabase = createAdminClient()
    const start = ymdOffset(1)
    const target = ymdOffset(3)

    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: `${start}T08:00:00.000Z`,
      created_by: null,
    })
    // Migration 048 : CHECK constraint impose assigned_team_id NOT NULL
    // pour status IN (in_progress, completed, validated). Il faut donc
    // assigner une équipe AVANT de pouvoir passer en in_progress.
    const team = await createTeam({ name: `${TEAM_PREFIX}MoveInProg` })
    await supabase
      .from('interventions')
      .update({
        scheduled_for: start,
        assigned_team_id: team.id,
        status: 'in_progress',
      })
      .eq('id', intvId)

    const r = await moveInterventionToDayAction({
      interventionId: intvId,
      newScheduledFor: target,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/démarrée|refusée|planned/i)

    // DB inchangée
    const { data } = await supabase
      .from('interventions')
      .select('scheduled_for, status')
      .eq('id', intvId)
      .maybeSingle()
    expect(data!.scheduled_for).toBe(start)
    expect(data!.status).toBe('in_progress')
  })

  it('refuse une date passée', async () => {
    const { moveInterventionToDayAction } = await importActions()
    const supabase = createAdminClient()
    const start = ymdOffset(1)
    const past = ymdOffset(-1) // hier

    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: `${start}T08:00:00.000Z`,
      created_by: null,
    })
    await supabase.from('interventions').update({ scheduled_for: start }).eq('id', intvId)

    const r = await moveInterventionToDayAction({
      interventionId: intvId,
      newScheduledFor: past,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/passée|refusée/i)

    // DB inchangée
    const { data } = await supabase
      .from('interventions')
      .select('scheduled_for')
      .eq('id', intvId)
      .maybeSingle()
    expect(data!.scheduled_for).toBe(start)
  })

  it('refuse une intervention inexistante', async () => {
    const { moveInterventionToDayAction } = await importActions()
    const r = await moveInterventionToDayAction({
      interventionId: '00000000-0000-4000-8000-000000000000',
      newScheduledFor: ymdOffset(2),
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/introuvable/i)
  })
})

// ---------------------------------------------------------------------------
// reassignInterventionTeamAction
// ---------------------------------------------------------------------------

describe('reassignInterventionTeamAction — Slice 9.4', () => {
  beforeAll(async () => {
    await setupTestData()
    globalThis.__REASSIGN_TEST_USER_ID__ = adminUserId
  })

  afterEach(async () => {
    await cleanupAfterEach()
  })

  afterAll(async () => {
    await cleanupAll()
    globalThis.__REASSIGN_TEST_USER_ID__ = undefined
  })

  it('affecte une intervention planned à une nouvelle équipe', async () => {
    const { reassignInterventionTeamAction } = await importActions()
    const supabase = createAdminClient()
    const team = await createTeam({ name: `${TEAM_PREFIX}Alpha` })
    const start = ymdOffset(1)

    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: `${start}T08:00:00.000Z`,
      created_by: null,
    })
    await supabase.from('interventions').update({ scheduled_for: start }).eq('id', intvId)

    const r = await reassignInterventionTeamAction({
      interventionId: intvId,
      newTeamId: team.id,
    })
    expect(r.ok).toBe(true)

    const { data } = await supabase
      .from('interventions')
      .select('assigned_team_id')
      .eq('id', intvId)
      .maybeSingle()
    expect(data!.assigned_team_id).toBe(team.id)
  })

  it('désaffecte une intervention (newTeamId = null)', async () => {
    const { reassignInterventionTeamAction } = await importActions()
    const supabase = createAdminClient()
    const team = await createTeam({ name: `${TEAM_PREFIX}Beta` })
    const start = ymdOffset(1)

    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: `${start}T08:00:00.000Z`,
      created_by: null,
    })
    await supabase
      .from('interventions')
      .update({ scheduled_for: start, assigned_team_id: team.id })
      .eq('id', intvId)

    const r = await reassignInterventionTeamAction({
      interventionId: intvId,
      newTeamId: null,
    })
    expect(r.ok).toBe(true)

    const { data } = await supabase
      .from('interventions')
      .select('assigned_team_id')
      .eq('id', intvId)
      .maybeSingle()
    expect(data!.assigned_team_id).toBeNull()
  })

  it('refuse une intervention non-planned (in_progress)', async () => {
    const { reassignInterventionTeamAction } = await importActions()
    const supabase = createAdminClient()
    const teamCurrent = await createTeam({ name: `${TEAM_PREFIX}Gamma` })
    const teamTarget = await createTeam({ name: `${TEAM_PREFIX}GammaTarget` })
    const start = ymdOffset(1)

    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: `${start}T08:00:00.000Z`,
      created_by: null,
    })
    // Migration 048 : CHECK assigned_team_id NOT NULL pour in_progress.
    // L'équipe courante est assignée AVANT le passage en in_progress.
    await supabase
      .from('interventions')
      .update({
        scheduled_for: start,
        assigned_team_id: teamCurrent.id,
        status: 'in_progress',
      })
      .eq('id', intvId)

    const r = await reassignInterventionTeamAction({
      interventionId: intvId,
      newTeamId: teamTarget.id,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/démarrée|refusée|planned/i)

    // DB inchangée — l'équipe doit être teamCurrent, pas teamTarget
    const { data } = await supabase
      .from('interventions')
      .select('assigned_team_id')
      .eq('id', intvId)
      .maybeSingle()
    expect(data!.assigned_team_id).toBe(teamCurrent.id)
  })

  it('refuse une équipe archivée', async () => {
    const { reassignInterventionTeamAction } = await importActions()
    const supabase = createAdminClient()
    const team = await createTeam({ name: `${TEAM_PREFIX}Delta` })
    await archiveTeam(team.id)
    const start = ymdOffset(1)

    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: `${start}T08:00:00.000Z`,
      created_by: null,
    })
    await supabase.from('interventions').update({ scheduled_for: start }).eq('id', intvId)

    const r = await reassignInterventionTeamAction({
      interventionId: intvId,
      newTeamId: team.id,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/archivée|inconnue/i)
  })

  it('refuse une équipe inexistante (uuid valide mais absent)', async () => {
    const { reassignInterventionTeamAction } = await importActions()
    const supabase = createAdminClient()
    const start = ymdOffset(1)

    const intvId = await createIntervention({
      mission_id: missionId,
      scheduled_at: `${start}T08:00:00.000Z`,
      created_by: null,
    })
    await supabase.from('interventions').update({ scheduled_for: start }).eq('id', intvId)

    const r = await reassignInterventionTeamAction({
      interventionId: intvId,
      newTeamId: '00000000-0000-4000-8000-000000000000',
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/archivée|inconnue/i)
  })
})
