// Slice E.2 — Tests pour les helpers DB share token "rapport mensuel".
//
// Couvre :
//   1. createMonthlyReportToken → row créée avec contract_id + report_month
//      + selected_photo_ids + dg_note, intervention_id NULL, expires_at ≈ +30j.
//   2. createMonthlyReportToken validation : nb photos hors bornes → throw.
//   3. createMonthlyReportToken validation : note trop longue → throw.
//   4. createMonthlyReportToken validation : reportMonth invalide → throw.
//   5. getMonthlyReportFromToken (token actif) → reportData + selected + note.
//   6. getMonthlyReportFromToken (token révoqué) → null.
//   7. getMonthlyReportFromToken (token expiré) → null.
//   8. getMonthlyReportFromToken (token d'intervention, pas mensuel) → null.
//   9. CHECK chk_token_kind : INSERT avec intervention_id ET contract_id → ERROR.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  createMonthlyReportToken,
  createShareToken,
  getMonthlyReportFromToken,
  revokeShareToken,
} from '@/lib/db/proof-share'

const TEST_TAG = '__test_monthly_share_e2__'
const CLIENT_NAME = `${TEST_TAG}_client`
const CONTRACT_NAME = `${TEST_TAG}_contract`
const TENDER_TITLE = `${TEST_TAG}_tender`

const TARGET_MONTH = '2026-03' // mars 2026 — aligné sur monthly-report.test.ts

let adminId: string
let tenderId: string
let clientId: string
let contractId: string
let siteId: string
let missionId: string
let interventionId: string
const photoIds: string[] = []

async function setupTestData() {
  const supabase = createAdminClient()

  const { data: admin } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (!admin) throw new Error('No admin user — seed needed')
  adminId = admin.id

  const { data: existingTender } = await supabase
    .from('tenders')
    .select('id')
    .eq('title', TENDER_TITLE)
    .maybeSingle()
  if (existingTender) {
    tenderId = existingTender.id
  } else {
    const { data, error } = await supabase
      .from('tenders')
      .insert({ title: TENDER_TITLE, status: 'ready', created_by: adminId })
      .select('id')
      .single()
    if (error) throw error
    tenderId = data.id
  }

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('name', CLIENT_NAME)
    .maybeSingle()
  if (existingClient) {
    clientId = existingClient.id
  } else {
    const { data, error } = await supabase
      .from('clients')
      .insert({ name: CLIENT_NAME })
      .select('id')
      .single()
    if (error) throw error
    clientId = data.id
  }

  contractId = await createContract({
    tender_id: tenderId,
    name: CONTRACT_NAME,
    client_name: CLIENT_NAME,
    start_date: '2026-01-01',
    created_by: adminId,
  })

  siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: `${TEST_TAG}_site`,
    address: '1 rue Tests',
  })

  missionId = await createMission({
    site_id: siteId,
    name: `${TEST_TAG}_mission`,
    cadence: 'daily',
    created_by: null,
  })

  // Insère une intervention pour pouvoir tester un cas dossier de preuves
  // (token "non monthly").
  const { data: itv, error: iErr } = await supabase
    .from('interventions')
    .insert({
      mission_id: missionId,
      scheduled_at: '2026-03-15T09:00:00.000Z',
      scheduled_for: '2026-03-15',
      executed_at: '2026-03-15T10:00:00.000Z',
      status: 'completed',
      team: [adminId],
    })
    .select('id')
    .single()
  if (iErr) throw iErr
  interventionId = itv.id

  // Insère 3 photos sur cette intervention pour test sélection.
  for (let i = 0; i < 3; i++) {
    const { data, error } = await supabase
      .from('intervention_photos')
      .insert({
        intervention_id: interventionId,
        storage_path: `__test_monthly_share/${i}.jpg`,
        caption: `Test photo ${i + 1}`,
        taken_at: `2026-03-15T10:0${i}:00.000Z`,
        kind: 'proof',
      })
      .select('id')
      .single()
    if (error) throw error
    photoIds.push(data.id)
  }
}

async function cleanupTokens() {
  const supabase = createAdminClient()
  await supabase.from('proof_share_tokens').delete().eq('contract_id', contractId)
  await supabase.from('proof_share_tokens').delete().eq('intervention_id', interventionId)
}

async function cleanupAll() {
  const supabase = createAdminClient()
  await supabase.from('proof_share_tokens').delete().eq('contract_id', contractId)
  await supabase.from('proof_share_tokens').delete().eq('intervention_id', interventionId)
  await supabase.from('intervention_photos').delete().eq('intervention_id', interventionId)
  await supabase.from('interventions').delete().eq('id', interventionId)

  const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
  if (sites && sites.length > 0) {
    const siteIds = sites.map((s) => s.id)
    await supabase.from('missions').delete().in('site_id', siteIds)
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

describe('proof_share_tokens — Slice E.2 monthly report helpers', () => {
  beforeAll(async () => {
    await setupTestData()
  }, 30_000)

  afterEach(async () => {
    await cleanupTokens()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  it('createMonthlyReportToken : row créée avec contract_id + report_month + selected_photo_ids', async () => {
    const before = Date.now()
    const tok = await createMonthlyReportToken({
      contractId,
      reportMonth: TARGET_MONTH,
      selectedPhotoIds: photoIds.slice(0, 2),
      dgNote: 'Très bon mois pour notre équipe.',
    })

    expect(tok.id).toBeDefined()
    expect(tok.token).toBeDefined()
    expect(tok.token.length).toBeGreaterThanOrEqual(30)
    expect(tok.intervention_id).toBeNull()
    expect(tok.contract_id).toBe(contractId)
    expect(tok.report_month).toBe(TARGET_MONTH)
    expect(tok.selected_photo_ids).toEqual(photoIds.slice(0, 2))
    expect(tok.dg_note).toBe('Très bon mois pour notre équipe.')
    expect(tok.include_identities).toBe(false)
    expect(tok.revoked_at).toBeNull()

    // Default 30 jours.
    const expMs = new Date(tok.expires_at).getTime()
    const expectedMin = before + 30 * 24 * 3600 * 1000 - 2000
    const expectedMax = before + 30 * 24 * 3600 * 1000 + 5000
    expect(expMs).toBeGreaterThanOrEqual(expectedMin)
    expect(expMs).toBeLessThanOrEqual(expectedMax)
  })

  it('createMonthlyReportToken : 0 photos → throw', async () => {
    await expect(
      createMonthlyReportToken({
        contractId,
        reportMonth: TARGET_MONTH,
        selectedPhotoIds: [],
        dgNote: '',
      }),
    ).rejects.toThrow(/selectedPhotoIds/)
  })

  it('createMonthlyReportToken : > 12 photos → throw', async () => {
    const tooMany = Array.from({ length: 13 }, () => photoIds[0]!)
    await expect(
      createMonthlyReportToken({
        contractId,
        reportMonth: TARGET_MONTH,
        selectedPhotoIds: tooMany,
        dgNote: '',
      }),
    ).rejects.toThrow(/selectedPhotoIds/)
  })

  it('createMonthlyReportToken : note > 300 chars → throw', async () => {
    const longNote = 'x'.repeat(301)
    await expect(
      createMonthlyReportToken({
        contractId,
        reportMonth: TARGET_MONTH,
        selectedPhotoIds: photoIds.slice(0, 1),
        dgNote: longNote,
      }),
    ).rejects.toThrow(/dgNote/)
  })

  it('createMonthlyReportToken : reportMonth invalide → throw', async () => {
    await expect(
      createMonthlyReportToken({
        contractId,
        reportMonth: '2026-13', // mois invalide
        selectedPhotoIds: photoIds.slice(0, 1),
        dgNote: '',
      }),
    ).rejects.toThrow(/reportMonth/)
  })

  it('getMonthlyReportFromToken : token actif → reportData + selection + note', async () => {
    const tok = await createMonthlyReportToken({
      contractId,
      reportMonth: TARGET_MONTH,
      selectedPhotoIds: photoIds.slice(0, 2),
      dgNote: 'Note du DG.',
    })

    const result = await getMonthlyReportFromToken(tok.token)
    expect(result).not.toBeNull()
    expect(result!.shareToken.id).toBe(tok.id)
    expect(result!.reportData.contract.id).toBe(contractId)
    expect(result!.reportData.period.year).toBe(2026)
    expect(result!.reportData.period.month).toBe(3)
    expect(result!.selectedPhotoIds).toEqual(photoIds.slice(0, 2))
    expect(result!.dgNote).toBe('Note du DG.')
  })

  it('getMonthlyReportFromToken : token révoqué → null', async () => {
    const tok = await createMonthlyReportToken({
      contractId,
      reportMonth: TARGET_MONTH,
      selectedPhotoIds: photoIds.slice(0, 1),
      dgNote: '',
    })
    await revokeShareToken(tok.id)

    const result = await getMonthlyReportFromToken(tok.token)
    expect(result).toBeNull()
  })

  it('getMonthlyReportFromToken : token expiré → null', async () => {
    // Insère directement un token expiré via admin client.
    const supabase = createAdminClient()
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from('proof_share_tokens')
      .insert({
        token: `expired-monthly-${Math.random().toString(36).slice(2)}`,
        intervention_id: null,
        contract_id: contractId,
        report_month: TARGET_MONTH,
        selected_photo_ids: photoIds.slice(0, 1),
        dg_note: '',
        expires_at: pastDate,
      })
      .select('token')
      .single()
    expect(error).toBeNull()
    expect(data).not.toBeNull()

    const result = await getMonthlyReportFromToken((data as { token: string }).token)
    expect(result).toBeNull()
  })

  it("getMonthlyReportFromToken : token de type intervention (pas rapport mensuel) → null", async () => {
    const tok = await createShareToken({ interventionId })
    const result = await getMonthlyReportFromToken(tok.token)
    expect(result).toBeNull()
  })

  it('CHECK chk_token_kind : INSERT avec intervention_id ET contract_id → ERROR', async () => {
    const supabase = createAdminClient()
    const { error } = await supabase.from('proof_share_tokens').insert({
      token: `mixed-${Math.random().toString(36).slice(2)}`,
      intervention_id: interventionId,
      contract_id: contractId,
      report_month: TARGET_MONTH,
      selected_photo_ids: photoIds.slice(0, 1),
      dg_note: '',
      expires_at: new Date(Date.now() + 1000 * 60).toISOString(),
    })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/chk_token_kind|check/)
  })

  it('CHECK chk_token_kind : INSERT sans intervention_id ni contract_id → ERROR', async () => {
    const supabase = createAdminClient()
    const { error } = await supabase.from('proof_share_tokens').insert({
      token: `none-${Math.random().toString(36).slice(2)}`,
      intervention_id: null,
      contract_id: null,
      report_month: null,
      expires_at: new Date(Date.now() + 1000 * 60).toISOString(),
    })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/chk_token_kind|check/)
  })
})
