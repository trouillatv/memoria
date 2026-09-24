// Test d'INTÉGRATION (vraie Supabase) — suite de contrat pour les vraies
// fonctions SQL materialize_engagement_create_new / materialize_engagement_link_existing
// (migration 436/437/438, via rpc, pas un mock).
//
// P0-2C FIX_REQUIRED (mandat Vincent 2026-09-24, revue SHA e88034a1, migration
// 438) : category/kind/measurable sont maintenant des paramètres humains
// OBLIGATOIRES (plus de DEFAULT 'other', plus de lecture repli sur
// source_payload — qui pouvait porter des valeurs IA non validées). Une
// proposition pending/rejected doit être refusée AVANT toute écriture, y
// compris quand des category/kind/measurable valides sont fournis.
//
// NE PAS EXÉCUTER avant application de la migration 438 : tant que 438 n'est
// pas appliquée, la RPC live a encore la signature à 3 paramètres (437) et ces
// appels à 5 paramètres échoueront (fonction introuvable pour cette
// signature) — cf. rapport HARD STOP, section migration.
//
// Conventions reprises de tests/lib/db/materialize-obligation-contract.test.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { activateEngagement } from '@/lib/db/engagements'

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

const DEFAULT_KIND = 'obligation'
const DEFAULT_CATEGORY = 'other'
const DEFAULT_MEASURABLE = false

async function createNew(
  proposalId: string,
  params: { category?: string | null; kind?: string | null; measurable?: boolean | null } = {},
) {
  const db = createAdminClient()
  return db.rpc('materialize_engagement_create_new', {
    p_proposal_id: proposalId,
    p_user_id: adminUserId,
    p_category: params.category === undefined ? DEFAULT_CATEGORY : params.category,
    p_kind: params.kind === undefined ? DEFAULT_KIND : params.kind,
    p_measurable: params.measurable === undefined ? DEFAULT_MEASURABLE : params.measurable,
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
  it('crée un nouvel engagement de porte B (site_id renseigné, tender_id NULL, status curated — PAS active) à partir d’une proposition acceptée avec preuve', async () => {
    const proposalId = await makeProposal({ label: `${TAG} create happy` })
    await attachEvidence(proposalId)

    const { data, error } = await createNew(proposalId, { category: 'quality', kind: 'controle', measurable: true })
    expect(error).toBeNull()
    const engagementId = data as string
    expect(engagementId).toBeTruthy()

    const db = createAdminClient()
    const { data: engagement } = await db
      .from('engagements')
      .select('id, tender_id, site_id, source_type, source_document_id, category, kind, measurable, short_label, status, organization_id')
      .eq('id', engagementId)
      .single()
    expect(engagement).toMatchObject({
      tender_id: null,
      site_id: siteId,
      // Doctrine source_type (cf. types/db.ts::EngagementSourceType) : ce RPC
      // hardcode 'manual' — jamais 'ao_clause'/'memoire_engagement', qui ne
      // sortent que du pipeline d'extraction IA Porte A. Garantie RPC, pas DB.
      source_type: 'manual',
      source_document_id: docId,
      category: 'quality',
      kind: 'controle',
      measurable: true,
      short_label: `${TAG} create happy`,
      status: 'curated',
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

  it('refuse une proposition rejetée — même avec des category/kind/measurable humains valides, zéro écriture', async () => {
    const proposalId = await makeProposal({ label: `${TAG} rejected`, review_status: 'rejected' })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId, { category: 'quality', kind: 'controle', measurable: true })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/non matérialisable/)

    const db = createAdminClient()
    const { count: engagementCount } = await db
      .from('engagements').select('id', { count: 'exact', head: true }).eq('short_label', `${TAG} rejected`)
    expect(engagementCount).toBe(0)
    const { count: matCount } = await db
      .from('document_proposal_materialization').select('id', { count: 'exact', head: true }).eq('proposal_id', proposalId)
    expect(matCount).toBe(0)
    const { data: proposal } = await db
      .from('document_extraction_proposal').select('review_status').eq('id', proposalId).single()
    expect((proposal as { review_status: string }).review_status).toBe('rejected')
  })

  it('refuse une proposition encore pending — même avec des category/kind/measurable humains valides, zéro écriture', async () => {
    const proposalId = await makeProposal({ label: `${TAG} pending`, review_status: 'pending' })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId, { category: 'quality', kind: 'controle', measurable: true })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/non matérialisable/)

    const db = createAdminClient()
    const { count: matCount } = await db
      .from('document_proposal_materialization').select('id', { count: 'exact', head: true }).eq('proposal_id', proposalId)
    expect(matCount).toBe(0)
    const { data: proposal } = await db
      .from('document_extraction_proposal').select('review_status').eq('id', proposalId).single()
    expect((proposal as { review_status: string }).review_status).toBe('pending')
  })

  it('refuse une nature (kind) absente', async () => {
    const proposalId = await makeProposal({ label: `${TAG} kind absent` })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId, { kind: null })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/Nature .* requise/)
  })

  it('refuse une nature (kind) invalide', async () => {
    const proposalId = await makeProposal({ label: `${TAG} kind invalid` })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId, { kind: 'not_a_real_kind' })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/Nature .* requise/)
  })

  it('refuse un mesurable (measurable) absent', async () => {
    const proposalId = await makeProposal({ label: `${TAG} measurable absent` })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId, { measurable: null })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/Mesurable .* requis/)
  })

  it('refuse une catégorie (category) absente', async () => {
    const proposalId = await makeProposal({ label: `${TAG} category absent` })
    await attachEvidence(proposalId)
    const { error } = await createNew(proposalId, { category: null })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/Catégorie .* requise/)
  })

  it('accepté avec des valeurs humaines DIFFÉRENTES du payload IA — l’Engagement porte EXACTEMENT les valeurs humaines', async () => {
    const proposalId = await makeProposal({
      label: `${TAG} human override`,
      source_payload: { kind: 'penalite', measurable: true, category: 'other' },
    })
    await attachEvidence(proposalId)

    const { data, error } = await createNew(proposalId, { category: 'sla', kind: 'obligation', measurable: false })
    expect(error).toBeNull()
    const engagementId = data as string

    const db = createAdminClient()
    const { data: engagement } = await db
      .from('engagements')
      .select('category, kind, measurable, status')
      .eq('id', engagementId)
      .single()
    expect(engagement).toMatchObject({ category: 'sla', kind: 'obligation', measurable: false, status: 'curated' })
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

describe('activateEngagement — activation séparée et explicite (curated → active)', () => {
  it('active un engagement porte B fraîchement matérialisé (curated)', async () => {
    const proposalId = await makeProposal({ label: `${TAG} activation happy` })
    await attachEvidence(proposalId)
    const { data: engagementId } = await createNew(proposalId)

    const db = createAdminClient()
    const before = await db.from('engagements').select('status').eq('id', engagementId as string).single()
    expect(before.data).toMatchObject({ status: 'curated' })

    await activateEngagement(engagementId as string)

    const after = await db.from('engagements').select('status').eq('id', engagementId as string).single()
    expect(after.data).toMatchObject({ status: 'active' })
  })

  it('refuse d’activer un engagement déjà actif (double activation)', async () => {
    const engagementId = await insertEngagement({ short_label: `${TAG} already active`, status: 'active' })
    await expect(activateEngagement(engagementId)).rejects.toThrow(/introuvable ou non activable/)
  })

  it('refuse d’activer un engagement archivé', async () => {
    const engagementId = await insertEngagement({ short_label: `${TAG} archived`, status: 'archived' })
    await expect(activateEngagement(engagementId)).rejects.toThrow(/introuvable ou non activable/)
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

describe('engagements_origin_door_check — XOR strict (migration 437)', () => {
  it('refuse un engagement avec tender_id ET site_id renseignés simultanément', async () => {
    const db = createAdminClient()
    const { error } = await db
      .from('engagements')
      .insert({
        tender_id: tenderId,
        site_id: siteId,
        source_type: 'manual',
        source_excerpt: `${TAG} double door`,
        category: 'other',
        short_label: `${TAG} double door`,
      })
      .select('id')
      .single()
    expect(error).not.toBeNull()
  })
})
