// Slice B.3 — Tests pour les helpers DB de proof_share_tokens.
//
// On teste la surface CRUD ainsi que la sémantique d'expiration / révocation
// directement contre Supabase (createAdminClient). Le rendu PDF n'est PAS testé
// ici (trop lourd pour vitest, validation visuelle au runtime).

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  createShareToken,
  getShareTokenByValue,
  getShareTokenByValueRaw,
  getShareTokenById,
  listShareTokensForIntervention,
  recordShareAccess,
  revokeShareToken,
} from '@/lib/db/proof-share'

const TEST_TENDER_TITLE = '__test_proof_share_b3_tender__'
const TEST_CLIENT_NAME = '__test_proof_share_b3_client__'

let tenderId: string
let clientId: string
let contractId: string
let siteId: string
let missionId: string
let interventionId: string
let adminId: string

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
    name: '__test_contract_proof_share_b3__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'Site Proof Share B3',
    address: '12 rue Tests',
  })

  missionId = await createMission({
    site_id: siteId,
    name: 'Mission Proof Share B3',
    cadence: 'daily',
    created_by: null,
  })

  const { data: itv, error: iErr } = await supabase
    .from('interventions')
    .insert({
      mission_id: missionId,
      scheduled_at: '2026-05-01T08:00:00.000Z',
      status: 'completed',
      team: [adminId],
    })
    .select('id')
    .single()
  if (iErr) throw iErr
  interventionId = itv.id
}

async function cleanupTokens() {
  const supabase = createAdminClient()
  await supabase.from('proof_share_tokens').delete().eq('intervention_id', interventionId)
}

async function cleanupAll() {
  const supabase = createAdminClient()
  await supabase.from('proof_share_tokens').delete().eq('intervention_id', interventionId)
  await supabase.from('interventions').delete().eq('id', interventionId)

  const { data: sites } = await supabase.from('sites').select('id').eq('client_id', clientId)
  if (sites && sites.length > 0) {
    const siteIds = sites.map((s) => s.id)
    await supabase.from('missions').delete().in('site_id', siteIds)
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

describe('proof_share_tokens — Slice B.3 helpers DB', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    await cleanupTokens()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  it('createShareToken : crée un token unique, expires_at ≈ now + 7 jours', async () => {
    const before = Date.now()
    const tok = await createShareToken({ interventionId })
    const after = Date.now()

    expect(tok.id).toBeDefined()
    expect(typeof tok.token).toBe('string')
    expect(tok.token.length).toBeGreaterThanOrEqual(30) // 24 bytes → ~32 chars base64url
    expect(tok.intervention_id).toBe(interventionId)
    expect(tok.revoked_at).toBeNull()
    expect(tok.include_identities).toBe(false)
    expect(tok.access_count).toBe(0)

    const expMs = new Date(tok.expires_at).getTime()
    const expectedMin = before + 7 * 24 * 3600 * 1000 - 1000 // -1s slack
    const expectedMax = after + 7 * 24 * 3600 * 1000 + 1000
    expect(expMs).toBeGreaterThanOrEqual(expectedMin)
    expect(expMs).toBeLessThanOrEqual(expectedMax)
  })

  it('createShareToken durationDays=14 → expires_at = now + 14 jours', async () => {
    const before = Date.now()
    const tok = await createShareToken({ interventionId, durationDays: 14 })
    const expMs = new Date(tok.expires_at).getTime()
    expect(expMs).toBeGreaterThanOrEqual(before + 14 * 24 * 3600 * 1000 - 1000)
    expect(expMs).toBeLessThanOrEqual(before + 14 * 24 * 3600 * 1000 + 5000)
  })

  it('createShareToken includeIdentities=true → row a include_identities=true', async () => {
    const tok = await createShareToken({ interventionId, includeIdentities: true })
    expect(tok.include_identities).toBe(true)
  })

  it('createShareToken clampe durationDays > 30 → max 30 jours', async () => {
    const before = Date.now()
    const tok = await createShareToken({ interventionId, durationDays: 9999 })
    const expMs = new Date(tok.expires_at).getTime()
    // Doit être <= now + 30j + 1s
    expect(expMs).toBeLessThanOrEqual(before + 30 * 24 * 3600 * 1000 + 2000)
    // Et >= now + 30j - 1s
    expect(expMs).toBeGreaterThanOrEqual(before + 30 * 24 * 3600 * 1000 - 2000)
  })

  it('getShareTokenByValue : retourne le bon row pour un token actif', async () => {
    const tok = await createShareToken({ interventionId })
    const found = await getShareTokenByValue(tok.token)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(tok.id)
    expect(found!.token).toBe(tok.token)
  })

  it('getShareTokenByValue : retourne null pour un token inexistant', async () => {
    const found = await getShareTokenByValue('nonexistent-token-zzz')
    expect(found).toBeNull()
  })

  it('getShareTokenByValue : retourne null pour un token révoqué', async () => {
    const tok = await createShareToken({ interventionId })
    await revokeShareToken(tok.id)
    const found = await getShareTokenByValue(tok.token)
    expect(found).toBeNull()

    // Mais raw retourne quand même.
    const raw = await getShareTokenByValueRaw(tok.token)
    expect(raw).not.toBeNull()
    expect(raw!.revoked_at).not.toBeNull()
  })

  it('getShareTokenByValue : retourne null pour un token expiré', async () => {
    // Insère directement un token expiré via admin client (createShareToken plafonne à +30j).
    const supabase = createAdminClient()
    const pastDate = new Date(Date.now() - 1000 * 60).toISOString() // -1 min
    const { data, error } = await supabase
      .from('proof_share_tokens')
      .insert({
        token: `expired-${Math.random().toString(36).slice(2)}`,
        intervention_id: interventionId,
        expires_at: pastDate,
      })
      .select('*')
      .single()
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    const tokenValue = (data as { token: string }).token

    const found = await getShareTokenByValue(tokenValue)
    expect(found).toBeNull()
  })

  it('getShareTokenById : retourne le row même si révoqué', async () => {
    const tok = await createShareToken({ interventionId })
    await revokeShareToken(tok.id)
    const got = await getShareTokenById(tok.id)
    expect(got).not.toBeNull()
    expect(got!.revoked_at).not.toBeNull()
  })

  it('revokeShareToken : pose revoked_at NOT NULL', async () => {
    const tok = await createShareToken({ interventionId })
    expect(tok.revoked_at).toBeNull()
    await revokeShareToken(tok.id)
    const got = await getShareTokenById(tok.id)
    expect(got!.revoked_at).not.toBeNull()
  })

  it('recordShareAccess : incrémente access_count + met à jour last_accessed_at', async () => {
    const tok = await createShareToken({ interventionId })
    expect(tok.access_count).toBe(0)
    expect(tok.last_accessed_at).toBeNull()

    await recordShareAccess(tok.id)
    const after1 = await getShareTokenById(tok.id)
    expect(after1!.access_count).toBe(1)
    expect(after1!.last_accessed_at).not.toBeNull()

    await recordShareAccess(tok.id)
    const after2 = await getShareTokenById(tok.id)
    expect(after2!.access_count).toBe(2)
  })

  it('listShareTokensForIntervention : liste les tokens actifs uniquement', async () => {
    const active1 = await createShareToken({ interventionId })
    const active2 = await createShareToken({ interventionId })
    const revoked = await createShareToken({ interventionId })
    await revokeShareToken(revoked.id)

    const list = await listShareTokensForIntervention(interventionId)
    const ids = list.map((t) => t.id)
    expect(ids).toContain(active1.id)
    expect(ids).toContain(active2.id)
    expect(ids).not.toContain(revoked.id)
  })
})
