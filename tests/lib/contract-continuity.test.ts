// Sprint 5 UX-9 — Preuve de continuité (Doctrine V5).
//
// Tests de getContractContinuity : compteurs factuels de stabilité du service.
//
// Doctrine vérifiée :
//   - On compte des FAITS bruts (jours, mois, semaines), aucun score.
//   - Aucune référence aux humains (le helper ne lit jamais d'identité).
//   - Pas de comparaison entre contrats. Pas de classement.
//
// 5 specs :
//   1. Contrat avec interventions consécutives → consecutiveMonthsWithIntervention = N
//   2. Contrat avec rupture de 2 mois → consecutiveMonthsWithIntervention coupé
//   3. weeksWithoutInterruption rétroactif depuis aujourd'hui
//   4. Contrat sans intervention → totalExecutedInterventions = 0
//   5. daysSinceLastIntervention = 0 si intervention aujourd'hui
//
// On crée des contrats isolés avec un préfixe TEST_TAG pour cleanup.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract, getContractContinuity } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'

const TEST_TAG = '__test_continuity_s5__'

interface Fixture {
  contractId: string
  siteId: string
  missionId: string
}

let adminId: string
const created: Fixture[] = []
let testClientId: string | null = null

async function ensureAdmin(): Promise<string> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!data) throw new Error('No admin user — seed needed before running this test')
  return data.id
}

async function ensureClient(): Promise<string> {
  if (testClientId) return testClientId
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('clients')
    .insert({ name: `${TEST_TAG}_client_${Date.now()}` })
    .select('id')
    .single()
  if (error) throw error
  testClientId = data.id
  return data.id
}

async function makeContractWithMission(opts: {
  startDate: string
  suffix: string
}): Promise<Fixture> {
  const supabase = createAdminClient()
  const clientId = await ensureClient()
  const contractId = await createContract({
    tender_id: null,
    name: `${TEST_TAG}_contract_${opts.suffix}`,
    client_name: `${TEST_TAG}_client`,
    start_date: opts.startDate,
    created_by: adminId,
  })
  const siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: `${TEST_TAG}_site_${opts.suffix}`,
  })
  const missionId = await createMission({
    site_id: siteId,
    name: `${TEST_TAG}_mission_${opts.suffix}`,
    cadence: 'daily',
    engagement_ids: [],
    created_by: adminId,
  })
  const fixture = { contractId, siteId, missionId }
  created.push(fixture)
  return fixture
}

async function insertExecutedIntervention(
  missionId: string,
  executedAtIso: string,
): Promise<string> {
  const supabase = createAdminClient()
  const d = new Date(executedAtIso)
  const { data, error } = await supabase
    .from('interventions')
    .insert({
      mission_id: missionId,
      scheduled_at: executedAtIso,
      scheduled_for: executedAtIso.slice(0, 10),
      status: 'completed',
      executed_at: executedAtIso,
      created_by: adminId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function cleanup() {
  const supabase = createAdminClient()
  for (const f of created) {
    // interventions
    const { data: intvs } = await supabase
      .from('interventions')
      .select('id')
      .eq('mission_id', f.missionId)
    const intvIds = (intvs ?? []).map((i) => i.id as string)
    if (intvIds.length > 0) {
      await supabase.from('intervention_photos').delete().in('intervention_id', intvIds)
      await supabase.from('intervention_anomalies').delete().in('intervention_id', intvIds)
      await supabase.from('intervention_validations').delete().in('intervention_id', intvIds)
      await supabase.from('interventions').delete().in('id', intvIds)
    }
    await supabase.from('missions').delete().eq('id', f.missionId)
    await supabase.from('sites').delete().eq('id', f.siteId)
    await supabase.from('contracts').delete().eq('id', f.contractId)
  }
  if (testClientId) {
    await supabase.from('clients').delete().eq('id', testClientId)
  }
}

describe('lib/db/contracts — getContractContinuity (Sprint 5 UX-9)', () => {
  beforeAll(async () => {
    adminId = await ensureAdmin()
  })
  afterAll(async () => {
    await cleanup()
  })

  it('contrat avec interventions consécutives sur 3 mois → consecutiveMonthsWithIntervention = 3', async () => {
    // Start 4 mois avant aujourd'hui pour avoir de la marge.
    const now = new Date()
    const startDate = new Date(now)
    startDate.setUTCMonth(startDate.getUTCMonth() - 4)
    const fixture = await makeContractWithMission({
      startDate: startDate.toISOString().slice(0, 10),
      suffix: 'consec-3',
    })

    // 3 interventions : mois courant, mois -1, mois -2.
    const m0 = new Date(now)
    const m1 = new Date(now)
    m1.setUTCMonth(m1.getUTCMonth() - 1)
    const m2 = new Date(now)
    m2.setUTCMonth(m2.getUTCMonth() - 2)
    await insertExecutedIntervention(fixture.missionId, m0.toISOString())
    await insertExecutedIntervention(fixture.missionId, m1.toISOString())
    await insertExecutedIntervention(fixture.missionId, m2.toISOString())

    const ctt = await getContractContinuity(fixture.contractId)
    expect(ctt).not.toBeNull()
    expect(ctt!.consecutiveMonthsWithIntervention).toBe(3)
    expect(ctt!.totalExecutedInterventions).toBeGreaterThanOrEqual(3)
  })

  it('contrat avec rupture de 2 mois → consecutiveMonthsWithIntervention coupé', async () => {
    // On crée des interventions mois courant + mois -3 et mois -4
    // (gap de 2 mois entre courant et -3). Le compteur consécutif doit valoir 1
    // (uniquement le mois courant compte, car -1 et -2 sont vides).
    const now = new Date()
    const startDate = new Date(now)
    startDate.setUTCMonth(startDate.getUTCMonth() - 6)
    const fixture = await makeContractWithMission({
      startDate: startDate.toISOString().slice(0, 10),
      suffix: 'rupture-2m',
    })

    const m0 = new Date(now)
    const mMinus3 = new Date(now)
    mMinus3.setUTCMonth(mMinus3.getUTCMonth() - 3)
    const mMinus4 = new Date(now)
    mMinus4.setUTCMonth(mMinus4.getUTCMonth() - 4)
    await insertExecutedIntervention(fixture.missionId, m0.toISOString())
    await insertExecutedIntervention(fixture.missionId, mMinus3.toISOString())
    await insertExecutedIntervention(fixture.missionId, mMinus4.toISOString())

    const ctt = await getContractContinuity(fixture.contractId)
    expect(ctt).not.toBeNull()
    // Mois courant compte → 1. Mois -1 et -2 sont vides, donc on s'arrête.
    expect(ctt!.consecutiveMonthsWithIntervention).toBe(1)
  })

  it('weeksWithoutInterruption se calcule rétroactivement depuis aujourd\'hui', async () => {
    // Interventions semaine courante + semaine -1 + semaine -2.
    // weeksWithoutInterruption doit être 3.
    const now = new Date()
    const startDate = new Date(now)
    startDate.setUTCMonth(startDate.getUTCMonth() - 3)
    const fixture = await makeContractWithMission({
      startDate: startDate.toISOString().slice(0, 10),
      suffix: 'weeks-3',
    })

    const w0 = new Date(now)
    const w1 = new Date(now)
    w1.setUTCDate(w1.getUTCDate() - 7)
    const w2 = new Date(now)
    w2.setUTCDate(w2.getUTCDate() - 14)
    await insertExecutedIntervention(fixture.missionId, w0.toISOString())
    await insertExecutedIntervention(fixture.missionId, w1.toISOString())
    await insertExecutedIntervention(fixture.missionId, w2.toISOString())

    const ctt = await getContractContinuity(fixture.contractId)
    expect(ctt).not.toBeNull()
    expect(ctt!.weeksWithoutInterruption).toBeGreaterThanOrEqual(3)
  })

  it('contrat sans intervention → totalExecutedInterventions = 0 et compteurs à 0', async () => {
    const now = new Date()
    const startDate = new Date(now)
    startDate.setUTCDate(startDate.getUTCDate() - 30)
    const fixture = await makeContractWithMission({
      startDate: startDate.toISOString().slice(0, 10),
      suffix: 'empty',
    })

    const ctt = await getContractContinuity(fixture.contractId)
    expect(ctt).not.toBeNull()
    expect(ctt!.totalExecutedInterventions).toBe(0)
    expect(ctt!.totalPhotos).toBe(0)
    expect(ctt!.totalAnomaliesResolved).toBe(0)
    expect(ctt!.consecutiveMonthsWithIntervention).toBe(0)
    expect(ctt!.weeksWithoutInterruption).toBe(0)
    // daysSinceLastIntervention tombe sur daysSinceStart par convention.
    expect(ctt!.daysSinceLastIntervention).toBe(ctt!.daysSinceStart)
  })

  it('daysSinceLastIntervention = 0 si intervention exécutée aujourd\'hui', async () => {
    const now = new Date()
    const startDate = new Date(now)
    startDate.setUTCDate(startDate.getUTCDate() - 60)
    const fixture = await makeContractWithMission({
      startDate: startDate.toISOString().slice(0, 10),
      suffix: 'today',
    })
    await insertExecutedIntervention(fixture.missionId, now.toISOString())

    const ctt = await getContractContinuity(fixture.contractId)
    expect(ctt).not.toBeNull()
    expect(ctt!.daysSinceLastIntervention).toBe(0)
  })
})
