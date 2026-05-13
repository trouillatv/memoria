// Slice 11.0 — Tests helpers DB dashboard cockpit (DB réelle).
//
// 8 specs :
//   1. getWeekPulse renvoie 3 nombres >= 0
//   2. getCapitalPreuves renvoie 3 nombres >= 0
//   3. getAOPipeline renvoie {analyzing, ready, submitted} >= 0
//   4. getOpenAnomaliesStats : oldCount <= total
//   5. getAtRiskEngagements : array <= 5
//   6. getContractsUnderTension : array trié par globalScore asc
//   7. getRecentActivity(5) : array <= 5, ordre antichronologique
//   8. Doctrine V3 ultime : aucun prénom dans les labels d'activité (regex)
//
// On crée un set minimal de données (un contrat actif + un engagement + une
// mission + une intervention avec photos + une validation + une anomalie) pour
// que chaque helper ait quelque chose à matcher. Cleanup en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  getWeekPulse,
  getCapitalPreuves,
  getAOPipeline,
  getOpenAnomaliesStats,
  getAtRiskEngagements,
  getContractsUnderTension,
  getRecentActivity,
} from '@/lib/db/dashboard'

const TEST_TAG = '__test_dashboard_s110__'
const TENDER_TITLE = `${TEST_TAG}_tender`
const CLIENT_NAME = `${TEST_TAG}_client`
const CONTRACT_NAME = `${TEST_TAG}_contract`
const SITE_NAME = `${TEST_TAG}_site`
const MISSION_NAME = `${TEST_TAG}_mission`

let adminId: string
let tenderId: string
let clientId: string
let contractId: string
let siteId: string
let missionId: string
let engagementId: string
let interventionRecentId: string
let interventionOldId: string

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

async function setup() {
  const supabase = createAdminClient()
  adminId = await ensureAdmin()

  // Tender (status ready → pèse dans getAOPipeline)
  const { data: tender, error: tErr } = await supabase
    .from('tenders')
    .insert({ title: TENDER_TITLE, status: 'ready', created_by: adminId })
    .select('id')
    .single()
  if (tErr) throw tErr
  tenderId = tender.id

  // Client
  const { data: client, error: clErr } = await supabase
    .from('clients')
    .insert({ name: CLIENT_NAME })
    .select('id')
    .single()
  if (clErr) throw clErr
  clientId = client.id

  // Contract actif
  contractId = await createContract({
    tender_id: tenderId,
    name: CONTRACT_NAME,
    client_name: CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: adminId,
  })

  // Site
  siteId = await createSite({ client_id: clientId, contract_id: contractId, name: SITE_NAME })

  // Engagement actif sur le contrat
  const { data: eng, error: eErr } = await supabase
    .from('engagements')
    .insert({
      tender_id: tenderId,
      contract_id: contractId,
      source_type: 'manual',
      source_excerpt: 'Test engagement dashboard slice 11.0',
      category: 'frequency',
      short_label: `${TEST_TAG}_engagement_label`,
      measurable: true,
      status: 'active',
      created_by: adminId,
    })
    .select('id')
    .single()
  if (eErr) throw eErr
  engagementId = eng.id

  // Mission couvrant l'engagement
  missionId = await createMission({
    site_id: siteId,
    name: MISSION_NAME,
    cadence: 'daily',
    engagement_ids: [engagementId],
    created_by: adminId,
  })

  // Intervention récente (cette semaine) status='completed' + executed_at = now
  const now = new Date()
  const recentIso = now.toISOString()
  const { data: intvRecent, error: intvErr } = await supabase
    .from('interventions')
    .insert({
      mission_id: missionId,
      scheduled_at: recentIso,
      scheduled_for: recentIso.slice(0, 10),
      status: 'completed',
      executed_at: recentIso,
      created_by: adminId,
    })
    .select('id')
    .single()
  if (intvErr) throw intvErr
  interventionRecentId = intvRecent.id

  // Intervention ancienne (15j) — fenêtre 30j tension mais pas semaine pulse
  const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
  const oldIso = old.toISOString()
  const { data: intvOld, error: ioErr } = await supabase
    .from('interventions')
    .insert({
      mission_id: missionId,
      scheduled_at: oldIso,
      scheduled_for: oldIso.slice(0, 10),
      status: 'validated',
      executed_at: oldIso,
      created_by: adminId,
    })
    .select('id')
    .single()
  if (ioErr) throw ioErr
  interventionOldId = intvOld.id

  // 2 photos sur intv récente
  await supabase.from('intervention_photos').insert([
    {
      intervention_id: interventionRecentId,
      storage_path: `__test/${interventionRecentId}/p1.jpg`,
      kind: 'proof',
    },
    {
      intervention_id: interventionRecentId,
      storage_path: `__test/${interventionRecentId}/p2.jpg`,
      kind: 'proof',
    },
  ])

  // 1 validation sur intv récente
  await supabase
    .from('intervention_validations')
    .insert({ intervention_id: interventionRecentId, validated_by: adminId })

  // 1 anomalie ancienne (>3j) non résolue
  const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
  await supabase.from('intervention_anomalies').insert({
    intervention_id: interventionRecentId,
    category: 'autre',
    description: TEST_TAG,
    status: 'open',
    created_at: fourDaysAgo,
  })
}

async function cleanup() {
  const supabase = createAdminClient()
  // interventions → photos/anomalies/validations cascade ON DELETE CASCADE.
  // On supprime explicitement par sécurité.
  const ids = [interventionRecentId, interventionOldId].filter(Boolean)
  if (ids.length > 0) {
    await supabase.from('intervention_photos').delete().in('intervention_id', ids)
    await supabase.from('intervention_anomalies').delete().in('intervention_id', ids)
    await supabase.from('intervention_validations').delete().in('intervention_id', ids)
    await supabase.from('interventions').delete().in('id', ids)
  }
  if (missionId) await supabase.from('missions').delete().eq('id', missionId)
  if (siteId) await supabase.from('sites').delete().eq('id', siteId)
  if (engagementId) await supabase.from('engagements').delete().eq('id', engagementId)
  if (contractId) await supabase.from('contracts').delete().eq('id', contractId)
  if (clientId) await supabase.from('clients').delete().eq('id', clientId)
  if (tenderId) await supabase.from('tenders').delete().eq('id', tenderId)
}

describe('lib/db/dashboard — Slice 11.0', () => {
  beforeAll(async () => {
    await setup()
  })
  afterAll(async () => {
    await cleanup()
  })

  it('getWeekPulse retourne 3 nombres >= 0', async () => {
    const pulse = await getWeekPulse()
    expect(pulse.interventionsExecuted).toBeGreaterThanOrEqual(0)
    expect(pulse.photosCount).toBeGreaterThanOrEqual(0)
    expect(pulse.validationsCount).toBeGreaterThanOrEqual(0)
    // Notre intervention récente devrait pousser ces compteurs >= 1.
    expect(pulse.interventionsExecuted).toBeGreaterThanOrEqual(1)
  })

  it('getCapitalPreuves retourne 3 nombres >= 0', async () => {
    const capital = await getCapitalPreuves()
    expect(capital.totalPhotos).toBeGreaterThanOrEqual(0)
    expect(capital.totalInterventionsExecuted).toBeGreaterThanOrEqual(0)
    expect(capital.totalContractsActive).toBeGreaterThanOrEqual(1) // notre contrat test
  })

  it('getAOPipeline retourne {analyzing, ready, submitted, renewalsDue} >= 0', async () => {
    const pipeline = await getAOPipeline()
    expect(pipeline.analyzing).toBeGreaterThanOrEqual(0)
    expect(pipeline.ready).toBeGreaterThanOrEqual(1) // notre tender test
    expect(pipeline.submitted).toBeGreaterThanOrEqual(0)
    expect(pipeline.renewalsDue).toBeGreaterThanOrEqual(0)
  })

  it('getOpenAnomaliesStats : oldCount <= total', async () => {
    const stats = await getOpenAnomaliesStats()
    expect(stats.total).toBeGreaterThanOrEqual(0)
    expect(stats.oldCount).toBeGreaterThanOrEqual(0)
    expect(stats.oldCount).toBeLessThanOrEqual(stats.total)
    // Notre anomalie de 4 jours doit compter dans oldCount.
    expect(stats.oldCount).toBeGreaterThanOrEqual(1)
  })

  it('getAtRiskEngagements retourne un array d\'au plus 5 éléments', async () => {
    const atRisk = await getAtRiskEngagements()
    expect(Array.isArray(atRisk)).toBe(true)
    expect(atRisk.length).toBeLessThanOrEqual(5)
    // Chaque élément doit avoir le shape attendu.
    for (const e of atRisk) {
      expect(typeof e.engagement_id).toBe('string')
      expect(typeof e.short_label).toBe('string')
      expect(typeof e.contract_id).toBe('string')
      expect(['no_intervention_recent', 'deadline_close', 'high_skip_rate']).toContain(e.reason)
      expect(typeof e.reasonDetail).toBe('string')
    }
  })

  it('getContractsUnderTension retourne un array trié par globalScore asc', async () => {
    const tension = await getContractsUnderTension()
    expect(Array.isArray(tension)).toBe(true)
    expect(tension.length).toBeLessThanOrEqual(5)
    // Tri croissant
    for (let i = 1; i < tension.length; i++) {
      expect(tension[i].globalScore).toBeGreaterThanOrEqual(tension[i - 1].globalScore)
    }
    // Chaque élément doit avoir 5 segments
    for (const c of tension) {
      expect(c.segmentScores).toHaveProperty('promised')
      expect(c.segmentScores).toHaveProperty('planned')
      expect(c.segmentScores).toHaveProperty('executed')
      expect(c.segmentScores).toHaveProperty('proven')
      expect(c.segmentScores).toHaveProperty('validated')
      expect(c.globalScore).toBeGreaterThanOrEqual(0)
      expect(c.globalScore).toBeLessThanOrEqual(1)
    }
  })

  it('getRecentActivity(5) : array <= 5, antichronologique', async () => {
    const events = await getRecentActivity(5)
    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBeLessThanOrEqual(5)
    // Antichronologique
    for (let i = 1; i < events.length; i++) {
      expect(events[i].occurredAt <= events[i - 1].occurredAt).toBe(true)
    }
    // Chaque event a un type connu
    const validTypes = [
      'intervention_executed',
      'intervention_validated',
      'anomaly_resolved',
      'tender_ready',
      'contract_activated',
      'evidence_inserted',
    ]
    for (const e of events) {
      expect(validTypes).toContain(e.type)
      expect(typeof e.label).toBe('string')
      expect(typeof e.contextLabel).toBe('string')
    }
  })

  // Test doctrine V3 ultime : aucun prénom typique d'agent dans le label.
  // On élargit largement à un fetch limit pour augmenter la chance de matcher
  // un événement réel s'il existe. Regex \b sur prénoms FR fréquents.
  it('Doctrine V3 : aucun prénom d\'agent dans label/contextLabel', async () => {
    const events = await getRecentActivity(50)
    const FORBIDDEN_NAMES =
      /\b(Mehdi|Léa|Lea|Sofia|Pierre|Marie|Jean|Paul|Lucie|Aurélie|Aurelie|Karim|Sarah|Thomas|Julie|Nicolas|Camille|Alice|Bob|Charlie)\b/i
    for (const e of events) {
      expect(e.label).not.toMatch(FORBIDDEN_NAMES)
      expect(e.contextLabel).not.toMatch(FORBIDDEN_NAMES)
    }
  })
})
