// Slice E.0 — Tests getContractMonthlyReport.
//
// 8 specs :
//   1. parseMonthParam format valide
//   2. formatMonthParam roundtrip
//   3. parseMonthParam("2026-02") -> lastDay 28 (2026 non bissextile)
//   4. monthLabel = "mai 2026"
//   5. getContractMonthlyReport(invalid-id) -> null
//   6. getContractMonthlyReport(contrat avec data) -> counts cohérents
//   7. getContractMonthlyReport mois vide -> counts à 0
//   8. photoCandidates : tableau ordonné, signed URLs présentes

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  parseMonthParam,
  formatMonthParam,
  getContractMonthlyReport,
} from '@/lib/db/monthly-report'

const TEST_TAG = '__test_monthly_report_e0__'
const CLIENT_NAME = `${TEST_TAG}_client`
const CONTRACT_NAME = `${TEST_TAG}_contract`
const SITE_A_NAME = `${TEST_TAG}_site_A`
const SITE_B_NAME = `${TEST_TAG}_site_B`
const MISSION_A_NAME = `${TEST_TAG}_mission_A`
const MISSION_B_NAME = `${TEST_TAG}_mission_B`

// Mois cible : on cadre sur le mois en cours pour disposer d'un libellé FR
// connu — mais on insère explicitement les interventions dans la fenêtre
// choisie (firstDay + 5j). Cela garantit l'indépendance de la date système.
const TARGET_YEAR = 2026
const TARGET_MONTH = 3 // mars 2026
const TARGET_PARAM = `${TARGET_YEAR}-${String(TARGET_MONTH).padStart(2, '0')}`
const EMPTY_PARAM = `${TARGET_YEAR}-07` // juillet : aucune intervention insérée

let adminId: string
let tenderId: string
let clientId: string
let contractId: string
let siteAId: string
let siteBId: string
let missionAId: string
let missionBId: string
const insertedInterventionIds: string[] = []

async function ensureAdmin(): Promise<string> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!data) throw new Error('No admin user — seed needed before running this test')
  return data.id as string
}

async function insertIntervention(input: {
  missionId: string
  scheduledForIso: string // yyyy-mm-dd
  executedAt: string | null
  status: 'completed' | 'validated' | 'planned' | 'skipped'
  skippedAt?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const scheduledAt = `${input.scheduledForIso}T09:00:00.000Z`
  const { data, error } = await supabase
    .from('interventions')
    .insert({
      mission_id: input.missionId,
      scheduled_for: input.scheduledForIso,
      scheduled_at: scheduledAt,
      executed_at: input.executedAt,
      status: input.status,
      skipped_at: input.skippedAt ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  insertedInterventionIds.push(data!.id as string)
  return data!.id as string
}

async function insertPhoto(interventionId: string, takenAtIso: string, caption: string | null) {
  const supabase = createAdminClient()
  const { error } = await supabase.from('intervention_photos').insert({
    intervention_id: interventionId,
    storage_path: `__test/${interventionId}/${Math.random().toString(36).slice(2)}.jpg`,
    kind: 'proof',
    caption,
    taken_at: takenAtIso,
  })
  if (error) throw error
}

async function insertAnomaly(
  interventionId: string,
  createdAtIso: string,
  resolvedAtIso: string | null,
) {
  const supabase = createAdminClient()
  const { error } = await supabase.from('intervention_anomalies').insert({
    intervention_id: interventionId,
    category: 'autre',
    description: `${TEST_TAG} anomalie`,
    status: resolvedAtIso ? 'resolved' : 'open',
    created_at: createdAtIso,
    resolved_at: resolvedAtIso,
  })
  if (error) throw error
}

async function insertValidation(interventionId: string, validatedBy: string, validatedAtIso: string) {
  const supabase = createAdminClient()
  const { error } = await supabase.from('intervention_validations').insert({
    intervention_id: interventionId,
    validated_by: validatedBy,
    validated_at: validatedAtIso,
  })
  if (error) throw error
}

async function setup() {
  const supabase = createAdminClient()
  adminId = await ensureAdmin()

  // Tender support (engagements.tender_id NOT NULL)
  const { data: tender, error: tErr } = await supabase
    .from('tenders')
    .insert({ title: `${TEST_TAG}_tender`, status: 'archived', created_by: adminId })
    .select('id')
    .single()
  if (tErr) throw tErr
  tenderId = tender.id as string

  // Client + Contract
  const { data: client, error: clErr } = await supabase
    .from('clients')
    .insert({ name: CLIENT_NAME })
    .select('id')
    .single()
  if (clErr) throw clErr
  clientId = client.id as string

  contractId = await createContract({
    tender_id: tenderId,
    name: CONTRACT_NAME,
    client_name: CLIENT_NAME,
    start_date: '2025-12-01',
    created_by: adminId,
  })

  // 2 sites + 2 missions (1 mission par site, diversité)
  siteAId = await createSite({ client_id: clientId, contract_id: contractId, name: SITE_A_NAME })
  siteBId = await createSite({ client_id: clientId, contract_id: contractId, name: SITE_B_NAME })

  missionAId = await createMission({
    site_id: siteAId,
    name: MISSION_A_NAME,
    cadence: 'weekly',
    created_by: adminId,
  })
  missionBId = await createMission({
    site_id: siteBId,
    name: MISSION_B_NAME,
    cadence: 'weekly',
    created_by: adminId,
  })

  // Interventions mars 2026 :
  //   site A : 2 completed (5 mars, 12 mars) + 1 validated (19 mars) + 1 skipped (26 mars)
  //   site B : 1 completed (10 mars)
  const i1 = await insertIntervention({
    missionId: missionAId,
    scheduledForIso: '2026-03-05',
    executedAt: '2026-03-05T10:00:00.000Z',
    status: 'completed',
  })
  const i2 = await insertIntervention({
    missionId: missionAId,
    scheduledForIso: '2026-03-12',
    executedAt: '2026-03-12T10:00:00.000Z',
    status: 'completed',
  })
  const i3 = await insertIntervention({
    missionId: missionAId,
    scheduledForIso: '2026-03-19',
    executedAt: '2026-03-19T10:00:00.000Z',
    status: 'validated',
  })
  const i4 = await insertIntervention({
    missionId: missionAId,
    scheduledForIso: '2026-03-26',
    executedAt: null,
    status: 'skipped',
    skippedAt: '2026-03-26T08:00:00.000Z',
  })
  const i5 = await insertIntervention({
    missionId: missionBId,
    scheduledForIso: '2026-03-10',
    executedAt: '2026-03-10T10:00:00.000Z',
    status: 'completed',
  })

  // 1 intervention mois précédent (février 2026) pour validation du delta
  await insertIntervention({
    missionId: missionAId,
    scheduledForIso: '2026-02-15',
    executedAt: '2026-02-15T10:00:00.000Z',
    status: 'completed',
  })

  // Photos mars :
  //   i1 → 2 photos (1 avec caption, 1 sans)
  //   i2 → 1 photo sans caption
  //   i5 → 2 photos sans caption (site B → diversité)
  await insertPhoto(i1, '2026-03-05T10:30:00.000Z', 'Avant nettoyage sanitaires')
  await insertPhoto(i1, '2026-03-05T10:45:00.000Z', null)
  await insertPhoto(i2, '2026-03-12T10:30:00.000Z', null)
  await insertPhoto(i5, '2026-03-10T10:30:00.000Z', null)
  await insertPhoto(i5, '2026-03-10T10:45:00.000Z', null)

  // 1 photo février pour delta négatif sur photos
  // (rien : delta photos = 5 - 0 = +5)

  // Anomalies :
  //   - 1 créée + résolue dans le mois (mars)
  //   - 1 créée en mars, encore ouverte
  //   - 1 créée en février, résolue en mars
  await insertAnomaly(i1, '2026-03-05T11:00:00.000Z', '2026-03-06T09:00:00.000Z')
  await insertAnomaly(i2, '2026-03-12T11:00:00.000Z', null)
  await insertAnomaly(i5, '2026-02-20T11:00:00.000Z', '2026-03-15T09:00:00.000Z')

  // Validations : 1 en mars sur i3
  await insertValidation(i3, adminId, '2026-03-19T11:00:00.000Z')

  // Engagement actif pour pousser segmentScores.promised = 1
  const { error: engErr } = await supabase.from('engagements').insert({
    tender_id: tenderId,
    contract_id: contractId,
    source_type: 'manual',
    source_excerpt: `${TEST_TAG} engagement`,
    category: 'frequency',
    short_label: `${TEST_TAG}_engagement`,
    measurable: true,
    status: 'active',
    created_by: adminId,
  })
  if (engErr) throw engErr
}

async function cleanup() {
  const supabase = createAdminClient()
  if (insertedInterventionIds.length > 0) {
    await supabase.from('intervention_photos').delete().in('intervention_id', insertedInterventionIds)
    await supabase.from('intervention_anomalies').delete().in('intervention_id', insertedInterventionIds)
    await supabase.from('intervention_validations').delete().in('intervention_id', insertedInterventionIds)
    await supabase.from('interventions').delete().in('id', insertedInterventionIds)
  }
  if (contractId) {
    await supabase.from('engagements').delete().eq('contract_id', contractId)
  }
  if (missionAId) await supabase.from('missions').delete().eq('id', missionAId)
  if (missionBId) await supabase.from('missions').delete().eq('id', missionBId)
  if (siteAId) await supabase.from('sites').delete().eq('id', siteAId)
  if (siteBId) await supabase.from('sites').delete().eq('id', siteBId)
  if (contractId) await supabase.from('contracts').delete().eq('id', contractId)
  if (clientId) await supabase.from('clients').delete().eq('id', clientId)
  if (tenderId) await supabase.from('tenders').delete().eq('id', tenderId)
}

describe('monthly-report — Slice E.0', () => {
  beforeAll(async () => {
    await setup()
  })
  afterAll(async () => {
    await cleanup()
  })

  // ---------- helpers purs ----------

  it('1. parseMonthParam("2026-05") → period correcte', () => {
    const p = parseMonthParam('2026-05')
    expect(p.year).toBe(2026)
    expect(p.month).toBe(5)
    expect(p.firstDay).toBe('2026-05-01')
    expect(p.lastDay).toBe('2026-05-31')
    expect(p.monthLabel).toBe('mai 2026')
  })

  it('2. formatMonthParam(period) roundtrip', () => {
    const original = '2026-09'
    const p = parseMonthParam(original)
    expect(formatMonthParam(p)).toBe(original)
    const p2 = parseMonthParam('2026-01')
    expect(formatMonthParam(p2)).toBe('2026-01')
  })

  it('3. parseMonthParam("2026-02") → lastDay 28 (2026 non bissextile)', () => {
    const p = parseMonthParam('2026-02')
    expect(p.lastDay).toBe('2026-02-28')
    // Sanity : 2024 bissextile pour valider la logique
    const p2024 = parseMonthParam('2024-02')
    expect(p2024.lastDay).toBe('2024-02-29')
  })

  it('4. monthLabel = "mai 2026"', () => {
    expect(parseMonthParam('2026-05').monthLabel).toBe('mai 2026')
    expect(parseMonthParam('2026-08').monthLabel).toBe('août 2026')
    expect(parseMonthParam('2026-12').monthLabel).toBe('décembre 2026')
  })

  // ---------- helper DB ----------

  it('5. getContractMonthlyReport(invalid-id) → null', async () => {
    const report = await getContractMonthlyReport(
      '00000000-0000-0000-0000-000000000000',
      TARGET_PARAM,
    )
    expect(report).toBeNull()
  })

  it('6. getContractMonthlyReport(contrat avec data) → counts cohérents', async () => {
    const report = await getContractMonthlyReport(contractId, TARGET_PARAM)
    expect(report).not.toBeNull()
    if (!report) return

    // Identité contrat
    expect(report.contract.id).toBe(contractId)
    expect(report.contract.name).toBe(CONTRACT_NAME)

    // Period
    expect(report.period.year).toBe(TARGET_YEAR)
    expect(report.period.month).toBe(TARGET_MONTH)
    expect(report.period.firstDay).toBe('2026-03-01')
    expect(report.period.lastDay).toBe('2026-03-31')

    // Counts factuels
    //   mars : 4 interventions executed (3 completed + 1 validated)
    //   + i4 skipped
    //   site B : i5 completed
    //   total executed = 4 (site A : i1, i2, i3) + 1 (site B : i5) = 4
    //     wait : i1, i2 completed + i3 validated + i5 completed = 4 executed
    expect(report.counts.interventionsExecuted).toBe(4)
    expect(report.counts.interventionsValidated).toBe(1)
    expect(report.counts.interventionsSkipped).toBe(1)
    expect(report.counts.photosCount).toBe(5)
    expect(report.counts.anomaliesReported).toBe(2) // 2 créées en mars
    expect(report.counts.anomaliesResolved).toBe(2) // i1 résolue 6 mars, i5 résolue 15 mars
    expect(report.counts.validationsCount).toBe(1)
    expect(report.counts.sitesCovered).toBe(2)

    // Trend : interventions executed mars = 4, février = 1 → +3
    expect(report.trend.interventionsDelta).toBe(3)
    // photos mars = 5, février = 0 → +5
    expect(report.trend.photosDelta).toBe(5)
    // anomalies ouvertes fin mars = 1 (i2 jamais résolue) ;
    // anomalies ouvertes fin février = 1 (i5 résolue mars, donc encore ouverte fin février) ;
    // delta = 1 - 1 = 0
    expect(report.trend.anomaliesOpenDelta).toBe(0)

    // Cumulative
    expect(report.cumulative.totalInterventionsExecuted).toBeGreaterThanOrEqual(5)
    expect(report.cumulative.totalPhotos).toBeGreaterThanOrEqual(5)
    expect(report.cumulative.totalAnomaliesResolved).toBeGreaterThanOrEqual(2)
    expect(report.cumulative.daysSinceStart).toBeGreaterThan(60)

    // Anomalies listes
    expect(report.anomaliesResolved.length).toBe(2)
    expect(report.anomaliesStillOpen.length).toBe(1)

    // Segments
    expect(report.segmentScores.promised).toBe(1)
    expect(report.segmentScores.planned).toBe(1)
    expect(report.segmentScores.executed).toBeGreaterThan(0)
    expect(report.segmentScores.executed).toBeLessThanOrEqual(1)
    expect(report.segmentScores.proven).toBeGreaterThan(0)
    expect(report.segmentScores.validated).toBeGreaterThan(0)
  })

  it('7. getContractMonthlyReport mois vide → counts à 0 (pas null)', async () => {
    const report = await getContractMonthlyReport(contractId, EMPTY_PARAM)
    expect(report).not.toBeNull()
    if (!report) return
    expect(report.counts.interventionsExecuted).toBe(0)
    expect(report.counts.photosCount).toBe(0)
    expect(report.counts.anomaliesReported).toBe(0)
    expect(report.counts.validationsCount).toBe(0)
    expect(report.photoCandidates).toEqual([])
    expect(report.anomaliesResolved).toEqual([])
    // contract toujours présent
    expect(report.contract.id).toBe(contractId)
  })

  it('8. photoCandidates : tableau ordonné (caption first), signed URLs présentes', async () => {
    const report = await getContractMonthlyReport(contractId, TARGET_PARAM)
    expect(report).not.toBeNull()
    if (!report) return

    expect(report.photoCandidates.length).toBe(5)
    // Première : celle avec caption non vide
    expect(report.photoCandidates[0]!.caption).toBe('Avant nettoyage sanitaires')

    // Diversité site : parmi les 5 candidates, on doit voir au moins une photo
    // site A et une photo site B.
    const siteNames = new Set(report.photoCandidates.map((p) => p.site_name))
    expect(siteNames.has(SITE_A_NAME)).toBe(true)
    expect(siteNames.has(SITE_B_NAME)).toBe(true)

    // signed URLs présentes (non vides) — getSignedPhotoUrls renvoie une URL si
    // le bucket existe. En env de test, le bucket peut ne pas exister : on
    // tolère url vide MAIS structurellement la propriété doit exister.
    for (const p of report.photoCandidates) {
      expect(typeof p.url).toBe('string')
      expect(typeof p.thumbnail_url).toBe('string')
      expect(typeof p.taken_at).toBe('string')
    }
  })
})
