// Sprint 6 — Tests des helpers de fermeture mentale (doctrine V5 verrou V3).
//
// Wording impératif : "clôturer" / "clôturé". JAMAIS "résolu". Voir
// docs/superpowers/doctrines/planning-doctrine.md §V5 verrou 3.
//
// On teste contre Supabase Cloud (createAdminClient) comme proof-share.test.ts.
// Setup minimal réutilisé (1 contrat, 1 site, 1 mission, 1 intervention).

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createContract } from '@/lib/db/contracts'
import { createSite } from '@/lib/db/sites'
import { createMission } from '@/lib/db/missions'
import {
  createShareToken,
  closeProofShareToken,
  reopenProofShareToken,
  countClosedThisMonth,
  getShareTokenById,
} from '@/lib/db/proof-share'

const TEST_TENDER_TITLE = '__test_proof_share_closure_tender__'
const TEST_CLIENT_NAME = '__test_proof_share_closure_client__'

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
    name: '__test_contract_proof_share_closure__',
    client_name: TEST_CLIENT_NAME,
    start_date: '2026-05-01',
    created_by: admin.id,
  })

  siteId = await createSite({
    client_id: clientId,
    contract_id: contractId,
    name: 'Site Proof Share Closure',
    address: '12 rue Tests Closure',
  })

  missionId = await createMission({
    site_id: siteId,
    name: 'Mission Proof Share Closure',
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

describe('proof_share_tokens — Sprint 6 fermeture mentale (verrou V3)', () => {
  beforeAll(async () => {
    await setupTestData()
  })

  afterEach(async () => {
    await cleanupTokens()
  })

  afterAll(async () => {
    await cleanupAll()
  })

  it('closeProofShareToken : pose closed_at NOT NULL + closed_by + note', async () => {
    const tok = await createShareToken({ interventionId })
    expect(tok.closed_at).toBeNull()

    await closeProofShareToken({
      tokenId: tok.id,
      closedBy: adminId,
      note: 'Échange finalisé après réunion du 15 mai',
    })

    const after = await getShareTokenById(tok.id)
    expect(after).not.toBeNull()
    expect(after!.closed_at).not.toBeNull()
    expect(after!.closed_by).toBe(adminId)
    expect(after!.closure_note).toBe('Échange finalisé après réunion du 15 mai')
  })

  it('closeProofShareToken sans note : closure_note reste null', async () => {
    const tok = await createShareToken({ interventionId })
    await closeProofShareToken({ tokenId: tok.id, closedBy: adminId })
    const after = await getShareTokenById(tok.id)
    expect(after!.closed_at).not.toBeNull()
    expect(after!.closure_note).toBeNull()
  })

  it('closeProofShareToken : double close → throw "déjà clôturé"', async () => {
    const tok = await createShareToken({ interventionId })
    await closeProofShareToken({ tokenId: tok.id, closedBy: adminId })

    await expect(
      closeProofShareToken({ tokenId: tok.id, closedBy: adminId }),
    ).rejects.toThrow(/déjà clôturé/i)
  })

  it('closeProofShareToken : note > 200 chars → throw', async () => {
    const tok = await createShareToken({ interventionId })
    const tooLong = 'x'.repeat(201)
    await expect(
      closeProofShareToken({ tokenId: tok.id, closedBy: adminId, note: tooLong }),
    ).rejects.toThrow(/note trop longue/i)
  })

  it('reopenProofShareToken : remet closed_at à NULL (et closed_by + note)', async () => {
    const tok = await createShareToken({ interventionId })
    await closeProofShareToken({
      tokenId: tok.id,
      closedBy: adminId,
      note: 'Note test',
    })
    let after = await getShareTokenById(tok.id)
    expect(after!.closed_at).not.toBeNull()
    expect(after!.closure_note).toBe('Note test')

    await reopenProofShareToken(tok.id)
    after = await getShareTokenById(tok.id)
    expect(after!.closed_at).toBeNull()
    expect(after!.closed_by).toBeNull()
    expect(after!.closure_note).toBeNull()
  })

  it('reopenProofShareToken : idempotent sur un token jamais clôturé', async () => {
    const tok = await createShareToken({ interventionId })
    // Ne doit pas throw.
    await reopenProofShareToken(tok.id)
    const after = await getShareTokenById(tok.id)
    expect(after!.closed_at).toBeNull()
  })

  it('countClosedThisMonth : compte les tokens fermés sur le mois courant uniquement', async () => {
    const before = await countClosedThisMonth()

    // Crée 2 tokens et clôture les deux.
    const t1 = await createShareToken({ interventionId })
    const t2 = await createShareToken({ interventionId })
    await closeProofShareToken({ tokenId: t1.id, closedBy: adminId })
    await closeProofShareToken({ tokenId: t2.id, closedBy: adminId })

    const after = await countClosedThisMonth()
    expect(after).toBe(before + 2)

    // Token clôturé dans un mois antérieur → ne doit PAS être compté.
    const supabase = createAdminClient()
    const t3 = await createShareToken({ interventionId })
    const lastMonth = new Date()
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1)
    await supabase
      .from('proof_share_tokens')
      .update({
        closed_at: lastMonth.toISOString(),
        closed_by: adminId,
      })
      .eq('id', t3.id)

    const after2 = await countClosedThisMonth()
    expect(after2).toBe(after) // pas d'incrément
  })
})
