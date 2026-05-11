// Slice B.4 — Tests pour le flux d'accès public à une preuve via /p/[token].
//
// On teste la combinaison des helpers utilisés par la route publique :
//   1. getShareTokenByValueRaw → retourne TOUS les états (le contrat dont
//      dépend la page pour distinguer 404 / révoqué / expiré / actif).
//   2. recordShareAccess → incrémente access_count + maj last_accessed_at,
//      garantissant l'audit côté DB.
//   3. La logique de filtrage côté page (qui dans la route est encodée
//      littéralement : revoked_at ? expires_at < now ? sinon valide).
//
// Le rendu HTML lui-même n'est PAS testé ici (server component async lourd à
// monter en jsdom + nécessite supabase mocks). La couverture comportementale
// se fait par les helpers DB qui drivent les états.

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
  recordShareAccess,
  revokeShareToken,
} from '@/lib/db/proof-share'

const TEST_TENDER_TITLE = '__test_public_proof_b4_tender__'
const TEST_CLIENT_NAME = '__test_public_proof_b4_client__'

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
    name: '__test_contract_public_proof_b4__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'Site Public Proof B4',
    address: '12 rue Tests B4',
  })

  missionId = await createMission({
    site_id: siteId,
    name: 'Mission Public Proof B4',
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
  await supabase
    .from('proof_share_tokens')
    .delete()
    .eq('intervention_id', interventionId)
}

async function cleanupAll() {
  const supabase = createAdminClient()
  await supabase
    .from('proof_share_tokens')
    .delete()
    .eq('intervention_id', interventionId)
  await supabase.from('interventions').delete().eq('id', interventionId)

  const { data: sites } = await supabase
    .from('sites')
    .select('id')
    .eq('client_id', clientId)
  if (sites && sites.length > 0) {
    const siteIds = sites.map((s) => s.id)
    await supabase.from('missions').delete().in('site_id', siteIds)
    await supabase.from('sites').delete().eq('client_id', clientId)
  }
  await supabase.from('contracts').delete().eq('id', contractId)
}

/**
 * Reproduit la logique de garde de /p/[token]/page.tsx pour assurer que les
 * mêmes branches sont testées. Retourne un statut symbolique.
 */
type PublicTokenStatus =
  | { kind: 'not_found' }
  | { kind: 'revoked'; revokedAt: string }
  | { kind: 'expired'; expiresAt: string }
  | { kind: 'active'; interventionId: string; includeIdentities: boolean }

async function classifyToken(tokenValue: string): Promise<PublicTokenStatus> {
  const raw = await getShareTokenByValueRaw(tokenValue)
  if (!raw) return { kind: 'not_found' }
  if (raw.revoked_at) return { kind: 'revoked', revokedAt: raw.revoked_at }
  if (new Date(raw.expires_at).getTime() < Date.now()) {
    return { kind: 'expired', expiresAt: raw.expires_at }
  }
  return {
    kind: 'active',
    interventionId: raw.intervention_id,
    includeIdentities: raw.include_identities,
  }
}

describe('public proof access — Slice B.4 flow', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    await cleanupTokens()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  it('token actif : classifyToken → active + recordShareAccess incrémente le compteur', async () => {
    const tok = await createShareToken({ interventionId })
    const status = await classifyToken(tok.token)
    expect(status.kind).toBe('active')
    if (status.kind === 'active') {
      expect(status.interventionId).toBe(interventionId)
      expect(status.includeIdentities).toBe(false)
    }

    // Audit : recordShareAccess doit incrémenter le compteur même via la route publique.
    await recordShareAccess(tok.id)
    const refreshed = await getShareTokenById(tok.id)
    expect(refreshed!.access_count).toBe(1)
    expect(refreshed!.last_accessed_at).not.toBeNull()
  })

  it('token inexistant : classifyToken → not_found', async () => {
    const status = await classifyToken('definitely-not-a-real-token-xyz')
    expect(status.kind).toBe('not_found')
  })

  it('token révoqué : classifyToken → revoked (et getShareTokenByValue le filtre)', async () => {
    const tok = await createShareToken({ interventionId })
    await revokeShareToken(tok.id)

    const status = await classifyToken(tok.token)
    expect(status.kind).toBe('revoked')

    // La fonction "filtrée" doit retourner null (garde-fou côté route alternative).
    const filtered = await getShareTokenByValue(tok.token)
    expect(filtered).toBeNull()
  })

  it('token expiré : classifyToken → expired', async () => {
    // Insertion directe d'un token expiré (createShareToken plafonne à +30j).
    const supabase = createAdminClient()
    const pastDate = new Date(Date.now() - 1000 * 60 * 60).toISOString() // -1h
    const { data, error } = await supabase
      .from('proof_share_tokens')
      .insert({
        token: `expired-public-${Math.random().toString(36).slice(2)}`,
        intervention_id: interventionId,
        expires_at: pastDate,
      })
      .select('*')
      .single()
    expect(error).toBeNull()
    const tokenValue = (data as { token: string }).token

    const status = await classifyToken(tokenValue)
    expect(status.kind).toBe('expired')

    const filtered = await getShareTokenByValue(tokenValue)
    expect(filtered).toBeNull()
  })

  it('token include_identities=true : classifyToken → active + flag identité', async () => {
    const tok = await createShareToken({
      interventionId,
      includeIdentities: true,
    })
    const status = await classifyToken(tok.token)
    expect(status.kind).toBe('active')
    if (status.kind === 'active') {
      expect(status.includeIdentities).toBe(true)
    }
  })

  it('recordShareAccess sur un token déjà supprimé : ne lève pas (best-effort)', async () => {
    // Best-effort : on appelle avec un id arbitraire. La fonction warn mais ne throw pas.
    await expect(
      recordShareAccess('00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeUndefined()
  })

  it('classifyToken : token actif redevenu révoqué → revoked immédiatement (pas de cache)', async () => {
    const tok = await createShareToken({ interventionId })
    let status = await classifyToken(tok.token)
    expect(status.kind).toBe('active')

    await revokeShareToken(tok.id)

    status = await classifyToken(tok.token)
    expect(status.kind).toBe('revoked')
  })
})
