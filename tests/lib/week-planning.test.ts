import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  getWeekRange,
  parseWeekParam,
  formatWeekParam,
  getWeekBySite,
  getWeekByTeam,
} from '@/lib/db/week-planning'
import { createTeam } from '@/lib/db/teams'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'

// Slice 9.1 — Tests helpers week-planning.
//
// Doctrine V2 :
//   - Vue Site × Jour primaire
//   - "Non-affecté" en dernier dans getWeekByTeam
//   - member_count descriptif, jamais analytique
//
// Tests PURS (pas de DB) en priorité, puis 1-2 tests DB minimaux.

// ============================================================
// Tests PURS — getWeekRange / parseWeekParam / formatWeekParam
// ============================================================

describe('week-planning — pure helpers (Slice 9.1)', () => {
  // 1. getWeekRange — mardi 2026-05-12 → semaine du Lun 2026-05-11 au Dim 2026-05-17
  it('getWeekRange("2026-05-12") → weekStart=2026-05-11, weekEnd=2026-05-17', () => {
    const r = getWeekRange('2026-05-12')
    expect(r.weekStart).toBe('2026-05-11')
    expect(r.weekEnd).toBe('2026-05-17')
    expect(r.weekNumber).toBe(20)
    expect(r.year).toBe(2026)
  })

  // 2. getWeekRange dimanche — appartient à la semaine qui commence le lundi précédent
  it('getWeekRange dimanche 2026-05-17 → même semaine (Lun 11 → Dim 17)', () => {
    const r = getWeekRange('2026-05-17')
    expect(r.weekStart).toBe('2026-05-11')
    expect(r.weekEnd).toBe('2026-05-17')
    expect(r.weekNumber).toBe(20)
  })

  // 3. getWeekRange lundi — c'est le lundi lui-même
  it('getWeekRange lundi 2026-05-11 → même semaine (Lun 11 → Dim 17)', () => {
    const r = getWeekRange('2026-05-11')
    expect(r.weekStart).toBe('2026-05-11')
    expect(r.weekEnd).toBe('2026-05-17')
    expect(r.weekNumber).toBe(20)
  })

  // 3b. Accepte Date object
  it('getWeekRange accepte un objet Date', () => {
    const r = getWeekRange(new Date('2026-05-13T15:30:00Z'))
    expect(r.weekStart).toBe('2026-05-11')
    expect(r.weekEnd).toBe('2026-05-17')
  })

  // 4. parseWeekParam + formatWeekParam roundtrip
  it('parseWeekParam("2026-W20") + formatWeekParam roundtrip', () => {
    const r = parseWeekParam('2026-W20')
    expect(r.weekStart).toBe('2026-05-11')
    expect(r.weekEnd).toBe('2026-05-17')
    expect(r.weekNumber).toBe(20)
    expect(r.year).toBe(2026)
    expect(formatWeekParam(r)).toBe('2026-W20')
  })

  // 4b. formatWeekParam pad zéro pour semaines < 10
  it('formatWeekParam pad zéro (2026-W05)', () => {
    const r = parseWeekParam('2026-W05')
    expect(formatWeekParam(r)).toBe('2026-W05')
  })

  // 5. parseWeekParam(undefined) → semaine courante
  it('parseWeekParam(undefined) retourne la semaine courante', () => {
    const r = parseWeekParam(undefined)
    const today = getWeekRange(new Date())
    expect(r.weekStart).toBe(today.weekStart)
    expect(r.weekEnd).toBe(today.weekEnd)
  })

  it('parseWeekParam(null) retourne la semaine courante', () => {
    const r = parseWeekParam(null)
    const today = getWeekRange(new Date())
    expect(r.weekStart).toBe(today.weekStart)
  })

  it('parseWeekParam("garbage") retourne fail-safe la semaine courante', () => {
    const r = parseWeekParam('garbage')
    const today = getWeekRange(new Date())
    expect(r.weekStart).toBe(today.weekStart)
  })

  // Bonus : bord d'année — 2025-12-29 (Lundi) appartient à 2026-W01 ISO
  it('bord d\'année : 2025-12-29 (Lun) → 2026-W01 ISO 8601', () => {
    const r = getWeekRange('2025-12-29')
    expect(r.weekStart).toBe('2025-12-29')
    expect(r.weekEnd).toBe('2026-01-04')
    expect(r.weekNumber).toBe(1)
    expect(r.year).toBe(2026)
  })
})

// ============================================================
// Tests DB minimaux — getWeekBySite, getWeekByTeam
// ============================================================

const TEST_TENDER_TITLE = '__test_phase9_week_tender__'
const TEST_CLIENT_NAME = '__test_phase9_week_client__'

let tenderId: string
let contractId: string
let clientId: string
let siteId: string
let missionId: string

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
    name: '__test_contract_phase9_week__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  siteId = await createSite({ client_id: clientId, contract_id: contractId, name: 'Site Test Semaine A' })
  missionId = await createMission({
    site_id: siteId,
    name: 'Mission test semaine',
    cadence: 'daily',
    created_by: null,
  })
}

async function cleanupTestInterventions() {
  const supabase = createAdminClient()
  await supabase.from('interventions').delete().eq('mission_id', missionId)
  // Purge équipes de test (cascade → team_members)
  await supabase.from('teams').delete().like('name', '\\_\\_test\\_phase9\\_week\\_%')
}

async function cleanupAll() {
  const supabase = createAdminClient()
  const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
  if (sites && sites.length > 0) {
    await supabase
      .from('interventions')
      .delete()
      .in(
        'mission_id',
        (
          await supabase.from('missions').select('id').in('site_id', sites.map((s) => s.id))
        ).data?.map((m) => m.id) ?? []
      )
    await supabase.from('missions').delete().in('site_id', sites.map((s) => s.id))
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

describe('week-planning — DB integration (Slice 9.1)', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    await cleanupTestInterventions()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  // 6. getWeekBySite avec 1 intervention → 1 site row, jour correct
  it('getWeekBySite : 1 intervention le mardi → 1 site row, bucket jour correct', async () => {
    const supabase = createAdminClient()
    // Intervention le mardi 2026-05-12
    const { error } = await supabase.from('interventions').insert({
      mission_id: missionId,
      scheduled_at: '2026-05-12T08:00:00.000Z',
      scheduled_for: '2026-05-12',
      slot: 'morning',
      status: 'planned',
    })
    expect(error).toBeNull()

    const range = getWeekRange('2026-05-12')
    const rows = await getWeekBySite(range)

    expect(rows.length).toBeGreaterThanOrEqual(1)
    const ourRow = rows.find((r) => r.site_id === siteId)
    expect(ourRow).toBeDefined()
    expect(ourRow!.site_name).toBe('Site Test Semaine A')
    expect(ourRow!.contract_name).toBe('__test_contract_phase9_week__')

    // 7 buckets de jour, le mardi contient 1 intervention
    expect(Object.keys(ourRow!.days)).toHaveLength(7)
    expect(ourRow!.days['2026-05-12']).toHaveLength(1)
    expect(ourRow!.days['2026-05-12'][0].mission_name).toBe('Mission test semaine')
    expect(ourRow!.days['2026-05-12'][0].slot).toBe('morning')
    // Le reste des jours est vide
    expect(ourRow!.days['2026-05-11']).toHaveLength(0)
    expect(ourRow!.days['2026-05-13']).toHaveLength(0)
  })

  // 7. getWeekByTeam "Non-affecté" en dernier
  it('getWeekByTeam : "Non-affecté" est en DERNIÈRE position, même avec teams', async () => {
    const supabase = createAdminClient()

    // 1 équipe Alpha + 1 équipe Zulu
    const alpha = await createTeam({ name: '__test_phase9_week_Alpha' })
    const zulu = await createTeam({ name: '__test_phase9_week_Zulu' })

    // 1 intervention affectée à Alpha, 1 affectée à Zulu, 1 non affectée
    const inserts = [
      {
        mission_id: missionId,
        scheduled_at: '2026-05-12T08:00:00.000Z',
        scheduled_for: '2026-05-12',
        slot: 'morning',
        status: 'planned',
        assigned_team_id: alpha.id,
      },
      {
        mission_id: missionId,
        scheduled_at: '2026-05-13T08:00:00.000Z',
        scheduled_for: '2026-05-13',
        slot: 'morning',
        status: 'planned',
        assigned_team_id: zulu.id,
      },
      {
        mission_id: missionId,
        scheduled_at: '2026-05-14T08:00:00.000Z',
        scheduled_for: '2026-05-14',
        slot: 'morning',
        status: 'planned',
        assigned_team_id: null,
      },
    ]
    const { error } = await supabase.from('interventions').insert(inserts)
    expect(error).toBeNull()

    const range = getWeekRange('2026-05-12')
    const rows = await getWeekByTeam(range)

    // "Non-affecté" doit être la DERNIÈRE ligne, peu importe les autres équipes
    expect(rows.length).toBeGreaterThanOrEqual(3) // au moins Alpha, Zulu, Non-affecté
    const last = rows[rows.length - 1]
    expect(last.team_id).toBeNull()
    expect(last.team_name).toBe('Non-affecté')
    // On vérifie que NOTRE intervention non-affectée est bien dans le bucket
    // (sans contraindre le total, la DB partagée peut contenir d'autres données)
    expect(last.days['2026-05-14'].some((c) => c.mission_id === missionId)).toBe(true)

    // Alpha et Zulu doivent être triés alphabétiquement, donc Alpha avant Zulu
    const teamRowsOnly = rows.filter((r) => r.team_id !== null)
    const ourAlpha = teamRowsOnly.find((r) => r.team_id === alpha.id)
    const ourZulu = teamRowsOnly.find((r) => r.team_id === zulu.id)
    expect(ourAlpha).toBeDefined()
    expect(ourZulu).toBeDefined()
    expect(teamRowsOnly.indexOf(ourAlpha!)).toBeLessThan(teamRowsOnly.indexOf(ourZulu!))

    // member_count par défaut = 0 (aucun membership)
    expect(ourAlpha!.member_count).toBe(0)

    // Bucket par jour pour chaque ligne
    expect(ourAlpha!.days['2026-05-12']).toHaveLength(1)
    expect(ourZulu!.days['2026-05-13']).toHaveLength(1)
  })
})
