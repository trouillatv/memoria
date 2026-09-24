// Test d'INTÉGRATION (vraie Supabase) — suite de contrat pour les vraies
// fonctions SQL materialize_engagement_create_new / materialize_engagement_link_existing
// (migration 436, via rpc, pas un mock).
//
// P0-2A (réalignement) : Porte B (chantier, sans AO). Une proposition
// 'engagement' acceptée/éditée ne produit que deux issues — create_new
// (nouvel engagement, site_id renseigné, tender_id NULL, status='active') ou
// link_existing (rattachement à un engagement existant du même
// chantier/organisation, zéro mutation de ses champs métier). Aucune Action
// n'est jamais générée par ce circuit.
//
// Conventions reprises de tests/lib/db/materialize-obligation-contract.test.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

const TAG = `__test_materialize_engagement_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let otherOrgId: string
let adminUserId: string
let clientId: string
let siteId: string
let otherSiteId: string
let docId: string
let runId: string
let tenderId: string

async function makeProposal(overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: orgId,
      extraction_run_id: runId,
      document_id: docId,
      target_site_id: siteId,
      proposal_family: 'engagement',
      label: `${TAG} engagement`,
      source_excerpt: `${TAG} extrait source de la proposition`,
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

async function createNew(proposalId: string, category?: string) {
  const db = createAdminClient()
  return db.rpc('materialize_engagement_create_new', {
    p_proposal_id: proposalId,
    p_user_id: adminUserId,
    ...(category ? { p_category: category } : {}),
  })
}

async function linkExisting(proposalId: string, engagementId: string) {
  const db = createAdminClient()
  return db.rpc('materialize_engagement_link_existing', {
    p_proposal_id: proposalId,
    p_engagement_id: engagementId,
    p_user_id: adminUserId,
  })
}

async function insertEngagement(overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('engagements')
    .insert({
      site_id: siteId,
      organization_id: orgId,
      source_type: 'manual',
      source_excerpt: `${TAG} source excerpt existante`,
      category: 'other',
      short_label: `${TAG} engagement existant`,
      status: 'active',
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

  otherOrgId = (await db.from('organizations').insert({ name: `${TAG}other_org` }).select('id').single()).data!.id as string
  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  otherSiteId = (await db.from('sites').insert({ name: `${TAG}other_site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  docId = (await db.from('documents').insert({ organization_id: orgId, document_type: 'cctp', storage_path: `${TAG}/cctp.pdf`, filename: 'cctp.pdf' }).select('id').single()).data!.id as string
  runId = (await db.from('document_extraction_run').insert({ organization_id: orgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string
  tenderId = (await db.from('tenders').insert({ title: `${TAG}tender`, status: 'submitted', created_by: adminUserId }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()
  // document cascade → run → proposals → evidence → proposal_evidence → materialization
  await db.from('documents').delete().eq('id', docId)
  await db.from('tenders').delete().eq('id', tenderId)
  // site cascade → engagements (site_id)
  await db.from('sites').delete().in('id', [siteId, otherSiteId])
  await db.from('clients').delete().eq('id', clientId)
  await db.from('organizations').delete().eq('id', otherOrgId)
})

describe('materialize_engagement_create_new', () => {
  it('crée un nouvel engagement de porte B (site_id renseigné, tender_id NULL, status active) à partir d’une proposition acceptée avec preuve', async () => {
    const proposalId = await makeProposal({ label: `${TAG} create happy` })
    await attachEvidence(proposalId)

    const { data, error } = await createNew(proposalId, 'quality')
    expect(error).toBeNull()
    const engagementId = data as string
    expect(engagementId).toBeTruthy()

    const db = createAdminClient()
    const { data: engagement } = await db
      .from('engagements')
      .select('id, tender_id, site_id, source_document_id, category, short_label, status, organization_id')
      .eq('id', engagementId)
      .single()
    expect(engagement).toMatchObject({
      tender_id: null,
      site_id: siteId,
      source_document_id: docId,
      category: 'quality',
      short_label: `${TAG} create happy`,
      status: 'active',
      organization_id: orgId,
    })

    const { data: mat } = await db
      .from('document_proposal_materialization')
      .select('target_entity_type, target_entity_id')
      .eq('proposal_id', proposalId)
      .maybeSingle()
    expect(mat).toMatchObject({ target_entity_type: 'engagement', target_entity_id: engagementId })

    const { data: proposal } = await db
      .from('document_extraction_proposal')
      .select('review_status')
      .eq('id', proposalId)
      .single()
    expect((proposal as { review_status: string }).review_status).toBe('materialized')
  })

  it('un rejeu (idempotence) retourne le même engagement sans en créer un deuxième', async () => {
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

  it('refuse une création sans extrait source (source_excerpt)', async () => {
    const proposalId = await makeProposal({ label: `${TAG} no excerpt`, source_excerpt: null })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/aucun extrait source/)
  })
})

describe('materialize_engagement_link_existing', () => {
  it('rattache une proposition à un engagement existant SANS muter ses champs métier', async () => {
    const engagementId = await insertEngagement({
      short_label: `${TAG} cible zéro-mutation`,
      status: 'active',
      category: 'compliance',
    })
    const proposalId = await makeProposal({ label: `${TAG} link happy` })

    const { data, error } = await linkExisting(proposalId, engagementId)
    expect(error).toBeNull()
    const matId = data as string
    expect(matId).toBeTruthy()

    const db = createAdminClient()
    const { data: engagement } = await db
      .from('engagements')
      .select('short_label, status, category')
      .eq('id', engagementId)
      .single()
    // Zéro mutation : les champs métier de la cible restent EXACTEMENT ceux
    // posés avant l'appel — link_existing n'écrit jamais engagements.
    expect(engagement).toMatchObject({
      short_label: `${TAG} cible zéro-mutation`,
      status: 'active',
      category: 'compliance',
    })

    const { data: mat } = await db
      .from('document_proposal_materialization')
      .select('id, target_entity_type, target_entity_id')
      .eq('id', matId)
      .single()
    expect(mat).toMatchObject({ target_entity_type: 'engagement', target_entity_id: engagementId })

    const { data: proposal } = await db
      .from('document_extraction_proposal')
      .select('review_status')
      .eq('id', proposalId)
      .single()
    expect((proposal as { review_status: string }).review_status).toBe('materialized')
  })

  it('un rejeu vers la même cible est un no-op idempotent', async () => {
    const engagementId = await insertEngagement({ short_label: `${TAG} link replay target` })
    const proposalId = await makeProposal({ label: `${TAG} link replay` })

    const first = await linkExisting(proposalId, engagementId)
    expect(first.error).toBeNull()
    const second = await linkExisting(proposalId, engagementId)
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
    const engagementA = await insertEngagement({ short_label: `${TAG} conflict A` })
    const engagementB = await insertEngagement({ short_label: `${TAG} conflict B` })
    const proposalId = await makeProposal({ label: `${TAG} link conflict` })

    const first = await linkExisting(proposalId, engagementA)
    expect(first.error).toBeNull()
    const second = await linkExisting(proposalId, engagementB)
    expect(second.error).not.toBeNull()
    expect(second.error!.message).toMatch(/déjà matérialisée/)
  })

  it('refuse un rattachement cross-site', async () => {
    const engagementOnOtherSite = await insertEngagement({ site_id: otherSiteId, short_label: `${TAG} cross-site` })
    const proposalId = await makeProposal({ label: `${TAG} link cross-site` })

    const { error } = await linkExisting(proposalId, engagementOnOtherSite)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/cross-site refusé/)
  })

  it('refuse un rattachement cross-organisation', async () => {
    const engagementWrongOrg = await insertEngagement({
      short_label: `${TAG} cross-org`,
      organization_id: otherOrgId,
    })
    const proposalId = await makeProposal({ label: `${TAG} link cross-org` })

    const { error } = await linkExisting(proposalId, engagementWrongOrg)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/organisation .* incohérente/)
  })
})

describe('non-régression Porte A (AO) — inchangée', () => {
  it('un engagement AO existant (tender_id renseigné, site_id NULL) reste valide sans modification', async () => {
    const db = createAdminClient()
    const { data, error } = await db
      .from('engagements')
      .insert({
        tender_id: tenderId,
        source_type: 'manual',
        source_excerpt: `${TAG} AO source excerpt`,
        category: 'quality',
        short_label: `${TAG} AO engagement`,
      })
      .select('id, tender_id, site_id, status')
      .single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ tender_id: tenderId, site_id: null, status: 'extracted' })
    await db.from('engagements').delete().eq('id', (data as { id: string }).id)
  })
})
