// Test d'INTÉGRATION (vraie Supabase) — suite de contrat pour les vraies
// fonctions SQL materialize_obligation_create_new / materialize_obligation_link_existing
// (migration 435, via rpc, pas un mock).
//
// P0-2A : une proposition 'obligation' acceptée/éditée ne produit que deux
// issues — create_new (nouvelle site_obligation) ou link_existing (rattachement
// à une obligation existante, zéro mutation de ses champs métier). Toute
// modification/suppression/réconciliation automatique d'une obligation
// existante reste hors périmètre (voir migration 435).
//
// Conventions reprises de tests/lib/db/materialize-historical-visit-contract.test.ts
// (TAG, beforeAll/afterAll org→client→site→document→run, lookup admin user,
// cleanup par cascade FK plutôt que suppressions manuelles quand le schéma le permet).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

const TAG = `__test_materialize_obligation_${Math.floor(Date.now() / 1000)}__`
const FAKE_OTHER_ORG_ID = '11111111-1111-1111-1111-111111111111'

let orgId: string
let adminUserId: string
let clientId: string
let siteId: string
let otherSiteId: string
let docId: string
let runId: string

async function makeProposal(overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: orgId,
      extraction_run_id: runId,
      document_id: docId,
      target_site_id: siteId,
      proposal_family: 'obligation',
      label: `${TAG} obligation`,
      review_status: 'accepted',
      ...overrides,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function attachEvidence(proposalId: string) {
  const db = createAdminClient()
  const { data: evidence, error } = await db
    .from('document_extraction_evidence')
    .insert({
      organization_id: orgId,
      extraction_run_id: runId,
      document_id: docId,
      evidence_type: 'text_excerpt',
    })
    .select('id')
    .single()
  if (error) throw error
  const evidenceId = (evidence as { id: string }).id
  const { error: linkError } = await db
    .from('document_proposal_evidence')
    .insert({ proposal_id: proposalId, evidence_id: evidenceId, relation_type: 'source' })
  if (linkError) throw linkError
  return evidenceId
}

async function createNew(proposalId: string) {
  const db = createAdminClient()
  return db.rpc('materialize_obligation_create_new', {
    p_proposal_id: proposalId,
    p_user_id: adminUserId,
  })
}

async function linkExisting(proposalId: string, obligationId: string) {
  const db = createAdminClient()
  return db.rpc('materialize_obligation_link_existing', {
    p_proposal_id: proposalId,
    p_obligation_id: obligationId,
    p_user_id: adminUserId,
  })
}

async function insertObligation(overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('site_obligation')
    .insert({
      site_id: siteId,
      organization_id: orgId,
      label: `${TAG} obligation existante`,
      responsible_role: 'entreprise',
      status: 'a_produire',
      ...overrides,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  const { data: admin } = await db.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('Aucun user admin — seed requis')
  adminUserId = (admin as { id: string }).id

  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  otherSiteId = (await db.from('sites').insert({ name: `${TAG}other_site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  docId = (await db.from('documents').insert({ organization_id: orgId, document_type: 'cctp', storage_path: `${TAG}/cctp.pdf`, filename: 'cctp.pdf' }).select('id').single()).data!.id as string
  runId = (await db.from('document_extraction_run').insert({ organization_id: orgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()
  // document cascade → run → proposals → evidence → proposal_evidence → materialization
  await db.from('documents').delete().eq('id', docId)
  // site cascade → site_obligation
  await db.from('sites').delete().in('id', [siteId, otherSiteId])
  await db.from('clients').delete().eq('id', clientId)
})

describe('materialize_obligation_create_new', () => {
  it('crée une nouvelle site_obligation à partir d’une proposition acceptée avec preuve', async () => {
    const proposalId = await makeProposal({ label: `${TAG} create happy` })
    await attachEvidence(proposalId)

    const { data, error } = await createNew(proposalId)
    expect(error).toBeNull()
    const obligationId = data as string
    expect(obligationId).toBeTruthy()

    const db = createAdminClient()
    const { data: obligation } = await db
      .from('site_obligation')
      .select('id, site_id, template_id, label, status')
      .eq('id', obligationId)
      .single()
    expect(obligation).toMatchObject({
      site_id: siteId,
      template_id: null,
      label: `${TAG} create happy`,
      status: 'a_produire',
    })

    const { data: mat } = await db
      .from('document_proposal_materialization')
      .select('target_entity_type, target_entity_id')
      .eq('proposal_id', proposalId)
      .maybeSingle()
    expect(mat).toMatchObject({ target_entity_type: 'site_obligation', target_entity_id: obligationId })

    const { data: proposal } = await db
      .from('document_extraction_proposal')
      .select('review_status')
      .eq('id', proposalId)
      .single()
    expect((proposal as { review_status: string }).review_status).toBe('materialized')
  })

  it('un rejeu (idempotence) retourne la même obligation sans en créer une deuxième', async () => {
    const proposalId = await makeProposal({ label: `${TAG} create replay` })
    await attachEvidence(proposalId)

    const first = await createNew(proposalId)
    expect(first.error).toBeNull()
    const second = await createNew(proposalId)
    expect(second.error).toBeNull()
    expect(second.data).toBe(first.data)

    const db = createAdminClient()
    const { count } = await db
      .from('document_proposal_materialization')
      .select('id', { count: 'exact', head: true })
      .eq('proposal_id', proposalId)
    expect(count).toBe(1)
  })

  it('refuse une proposition rejetée', async () => {
    const proposalId = await makeProposal({ label: `${TAG} rejected`, review_status: 'rejected' })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/non matérialisable/)
  })

  it('refuse une proposition encore pending', async () => {
    const proposalId = await makeProposal({ label: `${TAG} pending`, review_status: 'pending' })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/non matérialisable/)
  })

  it('refuse une proposition sans chantier cible', async () => {
    const proposalId = await makeProposal({ label: `${TAG} no site`, target_site_id: null })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/aucun chantier cible/)
  })

  it('refuse une proposition d’une autre famille', async () => {
    const proposalId = await makeProposal({ label: `${TAG} wrong family`, proposal_family: 'action' })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/famille .* invalide/)
  })

  it('refuse une création sans aucune preuve (evidence) liée', async () => {
    const proposalId = await makeProposal({ label: `${TAG} no evidence` })
    const { error } = await createNew(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/aucune preuve/)
  })
})

describe('materialize_obligation_link_existing', () => {
  it('rattache une proposition à une obligation existante SANS muter ses champs métier', async () => {
    const obligationId = await insertObligation({
      label: `${TAG} cible zéro-mutation`,
      status: 'en_cours',
      responsible_role: 'MOE',
    })
    const proposalId = await makeProposal({ label: `${TAG} link happy` })

    const { data, error } = await linkExisting(proposalId, obligationId)
    expect(error).toBeNull()
    const matId = data as string
    expect(matId).toBeTruthy()

    const db = createAdminClient()
    const { data: obligation } = await db
      .from('site_obligation')
      .select('label, status, responsible_role')
      .eq('id', obligationId)
      .single()
    // Zéro mutation : les champs métier de la cible restent EXACTEMENT ceux
    // posés avant l'appel — link_existing n'écrit jamais site_obligation.
    expect(obligation).toMatchObject({
      label: `${TAG} cible zéro-mutation`,
      status: 'en_cours',
      responsible_role: 'MOE',
    })

    const { data: mat } = await db
      .from('document_proposal_materialization')
      .select('id, target_entity_type, target_entity_id')
      .eq('id', matId)
      .single()
    expect(mat).toMatchObject({ target_entity_type: 'site_obligation', target_entity_id: obligationId })

    const { data: proposal } = await db
      .from('document_extraction_proposal')
      .select('review_status')
      .eq('id', proposalId)
      .single()
    expect((proposal as { review_status: string }).review_status).toBe('materialized')
  })

  it('un rejeu vers la même cible est un no-op idempotent', async () => {
    const obligationId = await insertObligation({ label: `${TAG} link replay target` })
    const proposalId = await makeProposal({ label: `${TAG} link replay` })

    const first = await linkExisting(proposalId, obligationId)
    expect(first.error).toBeNull()
    const second = await linkExisting(proposalId, obligationId)
    expect(second.error).toBeNull()
    expect(second.data).toBe(first.data)

    const db = createAdminClient()
    const { count } = await db
      .from('document_proposal_materialization')
      .select('id', { count: 'exact', head: true })
      .eq('proposal_id', proposalId)
    expect(count).toBe(1)
  })

  it('un rejeu vers une cible DIFFÉRENTE est un conflit explicite (aucune réconciliation auto)', async () => {
    const obligationA = await insertObligation({ label: `${TAG} conflict A` })
    const obligationB = await insertObligation({ label: `${TAG} conflict B` })
    const proposalId = await makeProposal({ label: `${TAG} link conflict` })

    const first = await linkExisting(proposalId, obligationA)
    expect(first.error).toBeNull()
    const second = await linkExisting(proposalId, obligationB)
    expect(second.error).not.toBeNull()
    expect(second.error!.message).toMatch(/déjà matérialisée/)
  })

  it('refuse un rattachement cross-site', async () => {
    const obligationOnOtherSite = await insertObligation({ site_id: otherSiteId, label: `${TAG} cross-site` })
    const proposalId = await makeProposal({ label: `${TAG} link cross-site` })

    const { error } = await linkExisting(proposalId, obligationOnOtherSite)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/cross-site refusé/)
  })

  it('refuse un rattachement cross-organisation', async () => {
    const obligationWrongOrg = await insertObligation({
      label: `${TAG} cross-org`,
      organization_id: FAKE_OTHER_ORG_ID,
    })
    const proposalId = await makeProposal({ label: `${TAG} link cross-org` })

    const { error } = await linkExisting(proposalId, obligationWrongOrg)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/organisation .* incohérente/)
  })
})
