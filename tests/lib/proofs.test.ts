// Slice B.0 — Tests searchProofs (DB réelle).
//
// Couvre :
//   1. Sans filtre → renvoie une page (limit respectée)
//   2. Filtre siteId → ne retourne que les interventions de ce site
//   3. Filtre dateFrom → ne retourne que celles >= dateFrom
//   4. Filtre dateTo → ne retourne que celles <= dateTo (inclusif)
//   5. Filtre search match site.name
//   6. Filtre search match mission.name
//   7. Ordre antichronologique
//   8. Counts photos / anomalies / validations corrects
//   9. total = count global, pas seulement la page

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import { searchProofs } from '@/lib/db/proofs'

const TEST_TENDER_TITLE = '__test_proofs_b0_tender__'
const TEST_CLIENT_NAME = '__test_proofs_b0_client__'
const SITE_A_NAME = 'Site Preuves Alpha Unique-XYZ'
const SITE_B_NAME = 'Site Preuves Bravo Unique-XYZ'
const MISSION_A_NAME = 'Nettoyage matinal preuves-A'
const MISSION_B_NAME = 'Nettoyage soir preuves-B'

let tenderId: string
let clientId: string
let contractId: string
let siteAId: string
let siteBId: string
let missionAId: string
let missionBId: string

let interventionRecentSiteAId: string
let interventionMidSiteAId: string
let interventionOldSiteAId: string
let interventionSiteBId: string

const TODAY = new Date()
const ISO_TODAY = TODAY.toISOString().slice(0, 10)

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function isoTimestamp(date: string, hours = 9): string {
  return `${date}T${String(hours).padStart(2, '0')}:00:00.000Z`
}

async function insertIntervention(input: {
  missionId: string
  scheduledFor: string
  status?: string
}) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('interventions')
    .insert({
      mission_id: input.missionId,
      scheduled_for: input.scheduledFor,
      scheduled_at: isoTimestamp(input.scheduledFor),
      status: input.status ?? 'planned',
    })
    .select('id')
    .single()
  if (error) throw error
  return data!.id as string
}

async function insertPhoto(interventionId: string) {
  const supabase = createAdminClient()
  const { error } = await supabase.from('intervention_photos').insert({
    intervention_id: interventionId,
    storage_path: `__test/${interventionId}/${Math.random().toString(36).slice(2)}.jpg`,
    kind: 'proof',
  })
  if (error) throw error
}

async function insertAnomaly(interventionId: string, status: 'open' | 'resolved' = 'open') {
  const supabase = createAdminClient()
  const { error } = await supabase.from('intervention_anomalies').insert({
    intervention_id: interventionId,
    category: 'autre',
    description: 'test',
    status,
    resolved_at: status === 'resolved' ? new Date().toISOString() : null,
  })
  if (error) throw error
}

async function insertValidation(interventionId: string, validatedBy: string) {
  const supabase = createAdminClient()
  const { error } = await supabase.from('intervention_validations').insert({
    intervention_id: interventionId,
    validated_by: validatedBy,
  })
  if (error) throw error
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
    name: '__test_contract_proofs_b0__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  siteAId = await createSite({ client_id: clientId, contract_id: contractId, name: SITE_A_NAME })
  siteBId = await createSite({ client_id: clientId, contract_id: contractId, name: SITE_B_NAME })

  missionAId = await createMission({
    site_id: siteAId,
    name: MISSION_A_NAME,
    cadence: 'daily',
    created_by: null,
  })
  missionBId = await createMission({
    site_id: siteBId,
    name: MISSION_B_NAME,
    cadence: 'daily',
    created_by: null,
  })

  // Site A : 3 interventions étalées sur 30 jours
  interventionRecentSiteAId = await insertIntervention({
    missionId: missionAId,
    scheduledFor: ISO_TODAY,
    status: 'completed',
  })
  interventionMidSiteAId = await insertIntervention({
    missionId: missionAId,
    scheduledFor: addDaysIso(ISO_TODAY, -7),
    status: 'validated',
  })
  interventionOldSiteAId = await insertIntervention({
    missionId: missionAId,
    scheduledFor: addDaysIso(ISO_TODAY, -25),
    status: 'completed',
  })

  // Site B : 1 intervention
  interventionSiteBId = await insertIntervention({
    missionId: missionBId,
    scheduledFor: addDaysIso(ISO_TODAY, -2),
    status: 'completed',
  })

  // Compteurs : la plus récente site A → 3 photos, 1 anomalie open, 0 validations
  await insertPhoto(interventionRecentSiteAId)
  await insertPhoto(interventionRecentSiteAId)
  await insertPhoto(interventionRecentSiteAId)
  await insertAnomaly(interventionRecentSiteAId, 'open')
  // Mid site A → 1 photo, 2 anomalies dont 1 resolved, 1 validation
  await insertPhoto(interventionMidSiteAId)
  await insertAnomaly(interventionMidSiteAId, 'open')
  await insertAnomaly(interventionMidSiteAId, 'resolved')
  await insertValidation(interventionMidSiteAId, admin.id)
}

async function cleanupAll() {
  const supabase = createAdminClient()
  const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
  if (sites && sites.length > 0) {
    const siteIds = sites.map((s) => s.id)
    const { data: missions } = await supabase
      .from('missions')
      .select('id')
      .in('site_id', siteIds)
    if (missions && missions.length > 0) {
      const missionIds = missions.map((m) => m.id)
      const { data: interventions } = await supabase
        .from('interventions')
        .select('id')
        .in('mission_id', missionIds)
      const interventionIds = (interventions ?? []).map((i) => i.id)
      if (interventionIds.length > 0) {
        await supabase.from('intervention_photos').delete().in('intervention_id', interventionIds)
        await supabase
          .from('intervention_anomalies')
          .delete()
          .in('intervention_id', interventionIds)
        await supabase
          .from('intervention_validations')
          .delete()
          .in('intervention_id', interventionIds)
        await supabase.from('interventions').delete().in('id', interventionIds)
      }
    }
    await supabase.from('missions').delete().in('site_id', siteIds)
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

describe('searchProofs — Slice B.0', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  it('sans filtre → renvoie une page bornée par le limit', async () => {
    const { items, total } = await searchProofs({ limit: 3 })
    expect(items.length).toBeLessThanOrEqual(3)
    // total compte l'ensemble (>= 4 puisqu'on a inséré au moins 4 rows de test).
    expect(total).toBeGreaterThanOrEqual(4)
  })

  it('filtre siteId → ne retourne que les interventions de ce site', async () => {
    const { items } = await searchProofs({ siteId: siteAId, limit: 50 })
    expect(items.length).toBeGreaterThanOrEqual(3)
    for (const it of items) {
      expect(it.site_id).toBe(siteAId)
    }
    // Inversement, le siteB ne doit pas apparaître.
    const ids = items.map((i) => i.id)
    expect(ids).not.toContain(interventionSiteBId)
  })

  it('filtre dateFrom → ne retourne que celles >= dateFrom', async () => {
    const cutoff = addDaysIso(ISO_TODAY, -10)
    const { items } = await searchProofs({ siteId: siteAId, dateFrom: cutoff, limit: 50 })
    const ids = items.map((i) => i.id)
    expect(ids).toContain(interventionRecentSiteAId)
    expect(ids).toContain(interventionMidSiteAId)
    expect(ids).not.toContain(interventionOldSiteAId)
  })

  it('filtre dateTo → ne retourne que celles <= dateTo (inclusif)', async () => {
    // Borne haute : 10 jours dans le passé. Recent (today) doit être exclu.
    const cutoff = addDaysIso(ISO_TODAY, -10)
    const { items } = await searchProofs({ siteId: siteAId, dateTo: cutoff, limit: 50 })
    const ids = items.map((i) => i.id)
    expect(ids).not.toContain(interventionRecentSiteAId)
    expect(ids).not.toContain(interventionMidSiteAId)
    expect(ids).toContain(interventionOldSiteAId)
  })

  it('filtre search par nom de site → matche', async () => {
    const { items } = await searchProofs({ search: 'Alpha Unique-XYZ', limit: 50 })
    // Tous matchent siteA
    expect(items.length).toBeGreaterThanOrEqual(3)
    for (const it of items) {
      expect(it.site_id).toBe(siteAId)
    }
  })

  it('filtre search par nom de mission → matche', async () => {
    const { items } = await searchProofs({ search: 'preuves-B', limit: 50 })
    const ids = items.map((i) => i.id)
    expect(ids).toContain(interventionSiteBId)
    expect(ids).not.toContain(interventionRecentSiteAId)
  })

  it('ordre antichronologique', async () => {
    const { items } = await searchProofs({ siteId: siteAId, limit: 50 })
    // Filtre les 3 du site A
    const found = items.filter((i) =>
      [interventionRecentSiteAId, interventionMidSiteAId, interventionOldSiteAId].includes(i.id),
    )
    expect(found.length).toBe(3)
    // Plus récent en tête
    expect(found[0]!.id).toBe(interventionRecentSiteAId)
    expect(found[1]!.id).toBe(interventionMidSiteAId)
    expect(found[2]!.id).toBe(interventionOldSiteAId)
  })

  it('counts photos/anomalies/validations corrects', async () => {
    const { items } = await searchProofs({ siteId: siteAId, limit: 50 })
    const recent = items.find((i) => i.id === interventionRecentSiteAId)
    const mid = items.find((i) => i.id === interventionMidSiteAId)
    const old = items.find((i) => i.id === interventionOldSiteAId)
    expect(recent).toBeDefined()
    expect(mid).toBeDefined()
    expect(old).toBeDefined()

    expect(recent!.photosCount).toBe(3)
    expect(recent!.anomaliesCount).toBe(1)
    expect(recent!.anomaliesResolvedCount).toBe(0)
    expect(recent!.validationsCount).toBe(0)

    expect(mid!.photosCount).toBe(1)
    expect(mid!.anomaliesCount).toBe(2)
    expect(mid!.anomaliesResolvedCount).toBe(1)
    expect(mid!.validationsCount).toBe(1)

    expect(old!.photosCount).toBe(0)
    expect(old!.anomaliesCount).toBe(0)
    expect(old!.validationsCount).toBe(0)
  })

  it('total reflète le count global, pas la page', async () => {
    const { items, total } = await searchProofs({ siteId: siteAId, limit: 1 })
    expect(items.length).toBe(1)
    expect(total).toBeGreaterThanOrEqual(3)
  })

  it('filtre status → ne retourne que le bon status', async () => {
    const { items } = await searchProofs({ siteId: siteAId, status: 'validated', limit: 50 })
    const ids = items.map((i) => i.id)
    expect(ids).toContain(interventionMidSiteAId)
    expect(ids).not.toContain(interventionRecentSiteAId)
    expect(ids).not.toContain(interventionOldSiteAId)
  })
})
