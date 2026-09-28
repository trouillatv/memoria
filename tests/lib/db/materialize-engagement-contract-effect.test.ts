// Test d'INTÉGRATION (vraie Supabase) — DOC-CONTRACT-OS-1B1 (GO Vincent
// 2026-09-28, migration 445). RPC atomique materialize_engagement_contract_effect :
// seule voie de persistance durable des effets contractuels confirmés
// (NEW/MODIFY/SUSPEND/CONFIRM). CONFLICT/NON_ENGAGEMENT/non qualifié ne
// produisent JAMAIS de ligne — cf. describe 'OS14 (témoin réel, non réparé)'.
//
// OS15 golden witness (mandat Vincent, fixture — pas de PDF requis) : les 4
// cas fonctionnels heureux (MODIFY permanent, SUSPEND bornée sans trou, NEW
// bornée, CONFIRM zéro-mutation) sont le describe 'OS15 — golden witness'.
//
// Conventions reprises de tests/lib/db/materialize-engagement-contract.test.ts
// (436/438) : mêmes helpers, mêmes conventions de nettoyage par cascade.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

const TAG = `__test_mat_contract_effect_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let otherOrgId: string
let adminUserId: string
let clientId: string
let siteId: string
let otherSiteId: string
let docId: string
let docWithEffectiveDateId: string
let otherOrgDocId: string
let runId: string

type ContractEffectQualification = {
  effect?: string
  temporality?: string
  scope?: string | null
  scopeKey?: string | null
  startsOn?: string | null
  endsOn?: string | null
  resumeOn?: string | null
  targetEngagementId?: string | null
}

async function makeProposal(
  contractEffect: ContractEffectQualification | null,
  overrides: Record<string, unknown> = {},
) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: orgId,
      extraction_run_id: runId,
      document_id: docId,
      target_site_id: siteId,
      proposal_family: 'engagement',
      label: `${TAG} proposal`,
      source_excerpt: `${TAG} extrait source de la proposition`,
      review_status: 'accepted',
      source_payload: contractEffect ? { contract_effect: contractEffect } : null,
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
}

async function makeQualifiedProposal(
  contractEffect: ContractEffectQualification,
  overrides: Record<string, unknown> = {},
) {
  const proposalId = await makeProposal(contractEffect, overrides)
  await attachEvidence(proposalId)
  return proposalId
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

async function callRpc(
  proposalId: string,
  opts: { category?: string | null; kind?: string | null; measurable?: boolean | null; effectPayload?: Record<string, unknown> } = {},
) {
  const db = createAdminClient()
  return db.rpc('materialize_engagement_contract_effect', {
    p_proposal_id: proposalId,
    p_user_id: adminUserId,
    p_category: opts.category ?? null,
    p_kind: opts.kind ?? null,
    p_measurable: opts.measurable ?? null,
    p_effect_payload: opts.effectPayload ?? {},
  })
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
  docId = (await db.from('documents').insert({ organization_id: orgId, document_type: 'ordre_service', storage_path: `${TAG}/os.pdf`, filename: 'os.pdf' }).select('id').single()).data!.id as string
  // Fix DOC-CONTRACT-OS-1B1 défaut 2 (revue Vincent 2026-09-28) : fixture positive
  // avec effective_date renseignée — sert de repli d'ancrage temporel quand
  // startsOn n'est pas qualifié. docId (sans effective_date) sert de témoin négatif.
  docWithEffectiveDateId = (await db.from('documents').insert({ organization_id: orgId, document_type: 'ordre_service', storage_path: `${TAG}/os-effective-date.pdf`, filename: 'os-effective-date.pdf', effective_date: '2026-11-15' }).select('id').single()).data!.id as string
  // Fix DOC-CONTRACT-OS-1B1 défaut C (2e revue Vincent 2026-09-28) : document
  // appartenant à otherOrgId — témoin négatif du fail-closed multi-org.
  otherOrgDocId = (await db.from('documents').insert({ organization_id: otherOrgId, document_type: 'ordre_service', storage_path: `${TAG}/os-other-org.pdf`, filename: 'os-other-org.pdf', effective_date: '2026-11-15' }).select('id').single()).data!.id as string
  runId = (await db.from('document_extraction_run').insert({ organization_id: orgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()
  // document cascade → run → proposals → evidence → proposal_evidence → materialization
  await db.from('documents').delete().eq('id', docId)
  await db.from('documents').delete().eq('id', docWithEffectiveDateId)
  await db.from('documents').delete().eq('id', otherOrgDocId)
  // engagement cascade → engagement_contract_effects
  await db.from('sites').delete().in('id', [siteId, otherSiteId])
  await db.from('clients').delete().eq('id', clientId)
  await db.from('organizations').delete().eq('id', otherOrgId)
})

describe('OS15 — golden witness (4 cas fonctionnels heureux, mandat Vincent)', () => {
  it('Cas 1 — MODIFY permanent : fréquence 2→3 passages/semaine sur un Engagement existant', async () => {
    const target = await insertEngagement({ short_label: `${TAG} Z1 frequence` })
    const proposalId = await makeQualifiedProposal({
      effect: 'modify',
      temporality: 'permanent',
      scope: 'Zone Z2, sanitaires',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      targetEngagementId: target,
    })

    const { data, error } = await callRpc(proposalId, {
      effectPayload: { frequency: { from: '2/semaine', to: '3/semaine' } },
    })
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string; engagement_id: string }>)[0]
    expect(row.engagement_id).toBe(target)

    const db = createAdminClient()
    const { data: effectRow } = await db
      .from('engagement_contract_effects')
      .select('effect, temporality, scope_key, effect_payload, starts_on, ends_on, engagement_id')
      .eq('id', row.effect_id)
      .single()
    expect(effectRow).toMatchObject({
      effect: 'modify',
      temporality: 'permanent',
      scope_key: 'frequency',
      effect_payload: { frequency: { from: '2/semaine', to: '3/semaine' } },
      starts_on: '2026-12-01',
      ends_on: null,
      engagement_id: target,
    })

    // Zéro mutation de l'Engagement lui-même — le read-model « applicable à
    // date » est le périmètre de 1B2, jamais de 1B1.
    const { data: engagement } = await db.from('engagements').select('short_label, status').eq('id', target).single()
    expect(engagement).toMatchObject({ short_label: `${TAG} Z1 frequence`, status: 'active' })
  })

  it('Cas 2 — SUSPEND bornée : Z4 suspendue 10/12→14/12, reprise 15/12 (aucun trou)', async () => {
    const target = await insertEngagement({ short_label: `${TAG} Z4 collecte` })
    const proposalId = await makeQualifiedProposal({
      effect: 'suspend',
      temporality: 'bounded',
      startsOn: '2026-12-10',
      endsOn: '2026-12-14',
      resumeOn: '2026-12-15',
      targetEngagementId: target,
    })

    const { data, error } = await callRpc(proposalId)
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string; engagement_id: string }>)[0]

    const db = createAdminClient()
    const { data: effectRow } = await db
      .from('engagement_contract_effects')
      .select('effect, temporality, starts_on, ends_on, resume_on')
      .eq('id', row.effect_id)
      .single()
    expect(effectRow).toMatchObject({
      effect: 'suspend',
      temporality: 'bounded',
      starts_on: '2026-12-10',
      ends_on: '2026-12-14',
      resume_on: '2026-12-15',
    })
  })

  it('Cas 3 — NEW bornée : nouvelle obligation de rapport photo hebdomadaire, 01/12/2026→31/01/2027', async () => {
    const proposalId = await makeQualifiedProposal(
      { effect: 'new', temporality: 'bounded', startsOn: '2026-12-01', endsOn: '2027-01-31' },
      { label: `${TAG} rapport photo hebdo` },
    )

    const { data, error } = await callRpc(proposalId, { category: 'reporting', kind: 'obligation', measurable: false })
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string; engagement_id: string }>)[0]
    expect(row.engagement_id).toBeTruthy()

    const db = createAdminClient()
    const { data: engagement } = await db
      .from('engagements')
      .select('site_id, tender_id, category, kind, status, short_label')
      .eq('id', row.engagement_id)
      .single()
    expect(engagement).toMatchObject({
      site_id: siteId,
      tender_id: null,
      category: 'reporting',
      kind: 'obligation',
      status: 'curated',
      short_label: `${TAG} rapport photo hebdo`,
    })

    const { data: effectRow } = await db
      .from('engagement_contract_effects')
      .select('effect, temporality, scope_key, starts_on, ends_on, engagement_id')
      .eq('id', row.effect_id)
      .single()
    expect(effectRow).toMatchObject({
      effect: 'new',
      temporality: 'bounded',
      scope_key: 'whole_engagement',
      starts_on: '2026-12-01',
      ends_on: '2027-01-31',
      engagement_id: row.engagement_id,
    })
  })

  it('Cas 4 — CONFIRM : registre de traçabilité réaffirmé, zéro mutation de la règle métier', async () => {
    const target = await insertEngagement({ short_label: `${TAG} registre traçabilité`, category: 'compliance' })
    const proposalId = await makeQualifiedProposal({
      effect: 'confirm',
      temporality: 'permanent',
      targetEngagementId: target,
    })

    // Même si l'appelant fournit une valeur métier par erreur, CONFIRM doit
    // la forcer à {} — zéro mutation garantie côté RPC, pas côté appelant.
    const { data, error } = await callRpc(proposalId, { effectPayload: { should: 'be ignored' } })
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string; engagement_id: string }>)[0]

    const db = createAdminClient()
    const { data: effectRow } = await db
      .from('engagement_contract_effects')
      .select('effect, effect_payload, engagement_id')
      .eq('id', row.effect_id)
      .single()
    expect(effectRow).toMatchObject({ effect: 'confirm', effect_payload: {}, engagement_id: target })

    const { data: engagement } = await db.from('engagements').select('short_label, category, status').eq('id', target).single()
    expect(engagement).toMatchObject({ short_label: `${TAG} registre traçabilité`, category: 'compliance', status: 'active' })
  })
})

describe('OS14 (témoin réel, non réparé) — reproduit structurellement : conflict/non qualifié bloquent toujours', () => {
  it('effet conflict qualifié → refusé, zéro écriture', async () => {
    const proposalId = await makeQualifiedProposal({ effect: 'conflict', temporality: 'permanent' })
    const { error } = await callRpc(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/non matérialisable/)

    const db = createAdminClient()
    const { count } = await db
      .from('engagement_contract_effects').select('id', { count: 'exact', head: true }).eq('source_proposal_id', proposalId)
    expect(count).toBe(0)
  })

  it('proposition acceptée sans contract_effect qualifié (CCTP historique) → refusée, zéro écriture', async () => {
    const proposalId = await makeProposal(null, { label: `${TAG} non qualifié` })
    await attachEvidence(proposalId)
    const { error } = await callRpc(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/non matérialisable/)

    const db = createAdminClient()
    const { count } = await db
      .from('engagement_contract_effects').select('id', { count: 'exact', head: true }).eq('source_proposal_id', proposalId)
    expect(count).toBe(0)
  })

  it('proposition rejetée, même qualifiée NEW valide → refusée avant toute écriture', async () => {
    const proposalId = await makeQualifiedProposal(
      { effect: 'new', temporality: 'permanent' },
      { label: `${TAG} rejetée`, review_status: 'rejected' },
    )
    const { error } = await callRpc(proposalId, { category: 'other', kind: 'obligation', measurable: false })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/non matérialisable/)

    const db = createAdminClient()
    const { count: engagementCount } = await db
      .from('engagements').select('id', { count: 'exact', head: true }).eq('short_label', `${TAG} rejetée`)
    expect(engagementCount).toBe(0)
  })
})

describe('invariants complémentaires (mandat Vincent 1B1)', () => {
  it('NEW : rollback intégral si le payload effet est invalide après création de l’Engagement (scope_key malformé)', async () => {
    const proposalId = await makeQualifiedProposal(
      { effect: 'new', temporality: 'permanent', scopeKey: 'Not A Valid Slug !!', startsOn: '2026-01-01' },
      { label: `${TAG} new rollback scope invalide` },
    )
    const { error } = await callRpc(proposalId, { category: 'other', kind: 'obligation', measurable: false })
    expect(error).not.toBeNull()

    const db = createAdminClient()
    // L'INSERT dans engagements s'exécute AVANT celui dans
    // engagement_contract_effects, dans la MÊME transaction : si ce dernier
    // échoue (CHECK scope_key_format), le premier doit être invisible.
    const { count: engagementCount } = await db
      .from('engagements').select('id', { count: 'exact', head: true }).eq('short_label', `${TAG} new rollback scope invalide`)
    expect(engagementCount).toBe(0)
    const { count: effectCount } = await db
      .from('engagement_contract_effects').select('id', { count: 'exact', head: true }).eq('source_proposal_id', proposalId)
    expect(effectCount).toBe(0)
  })

  it('SUSPEND event_driven (ouverte) : ends_on/resume_on absents restent NULL', async () => {
    const target = await insertEngagement({ short_label: `${TAG} suspend ouverte` })
    const proposalId = await makeQualifiedProposal({
      effect: 'suspend',
      temporality: 'event_driven',
      startsOn: '2026-12-01',
      targetEngagementId: target,
    })
    const { data, error } = await callRpc(proposalId)
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string }>)[0]

    const db = createAdminClient()
    const { data: effectRow } = await db
      .from('engagement_contract_effects')
      .select('temporality, starts_on, ends_on, resume_on')
      .eq('id', row.effect_id)
      .single()
    expect(effectRow).toMatchObject({ temporality: 'event_driven', starts_on: '2026-12-01', ends_on: null, resume_on: null })
  })

  it('MODIFY/SUSPEND/CONFIRM sans Engagement cible qualifié → refusé', async () => {
    const proposalId = await makeQualifiedProposal({ effect: 'modify', temporality: 'permanent', scopeKey: 'frequency' })
    const { error } = await callRpc(proposalId, { effectPayload: { foo: 'bar' } })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/exige un Engagement cible qualifié/)
  })

  it('refuse un rattachement cross-site', async () => {
    const target = await insertEngagement({ site_id: otherSiteId, short_label: `${TAG} cross-site` })
    const proposalId = await makeQualifiedProposal({
      effect: 'confirm',
      temporality: 'permanent',
      targetEngagementId: target,
    })
    const { error } = await callRpc(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/cross-site refusé/)
  })

  it('refuse un rattachement cross-organisation', async () => {
    const target = await insertEngagement({ organization_id: otherOrgId, short_label: `${TAG} cross-org` })
    const proposalId = await makeQualifiedProposal({
      effect: 'confirm',
      temporality: 'permanent',
      targetEngagementId: target,
    })
    const { error } = await callRpc(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/cross-org refusé/)
  })

  it('MODIFY sans scope_key qualifié → refusé', async () => {
    const target = await insertEngagement({ short_label: `${TAG} modify sans scope` })
    const proposalId = await makeQualifiedProposal({
      effect: 'modify',
      temporality: 'permanent',
      targetEngagementId: target,
    })
    const { error } = await callRpc(proposalId, { effectPayload: { foo: 'bar' } })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/scope qualifié/)
  })

  it('MODIFY sans effect_payload → refusé', async () => {
    const target = await insertEngagement({ short_label: `${TAG} modify sans payload` })
    const proposalId = await makeQualifiedProposal({
      effect: 'modify',
      temporality: 'permanent',
      scopeKey: 'frequency',
      targetEngagementId: target,
    })
    const { error } = await callRpc(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/effect_payload non vide/)
  })

  it('idempotence : un rejeu retourne exactement la même paire (effect_id, engagement_id), zéro doublon', async () => {
    const target = await insertEngagement({ short_label: `${TAG} idempotence` })
    const proposalId = await makeQualifiedProposal({
      effect: 'confirm',
      temporality: 'permanent',
      targetEngagementId: target,
    })
    const first = await callRpc(proposalId)
    expect(first.error).toBeNull()
    const second = await callRpc(proposalId)
    expect(second.error).toBeNull()
    expect(second.data).toEqual(first.data)

    const db = createAdminClient()
    const { count } = await db
      .from('engagement_contract_effects').select('id', { count: 'exact', head: true }).eq('source_proposal_id', proposalId)
    expect(count).toBe(1)
  })

  it('provenance préservée : source_document_id, source_proposal_id, applied_by portés par la ligne d’effet', async () => {
    const target = await insertEngagement({ short_label: `${TAG} provenance` })
    const proposalId = await makeQualifiedProposal({
      effect: 'confirm',
      temporality: 'permanent',
      targetEngagementId: target,
    })
    const { data, error } = await callRpc(proposalId)
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string }>)[0]

    const db = createAdminClient()
    const { data: effectRow } = await db
      .from('engagement_contract_effects')
      .select('source_document_id, source_proposal_id, applied_by, organization_id')
      .eq('id', row.effect_id)
      .single()
    expect(effectRow).toMatchObject({
      source_document_id: docId,
      source_proposal_id: proposalId,
      applied_by: adminUserId,
      organization_id: orgId,
    })
  })

  it('refuse une proposition d’une autre famille', async () => {
    const proposalId = await makeQualifiedProposal(
      { effect: 'new', temporality: 'permanent' },
      { label: `${TAG} wrong family`, proposal_family: 'action' },
    )
    const { error } = await callRpc(proposalId, { category: 'other', kind: 'obligation', measurable: false })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/famille .* invalide/)
  })
})

// ─── FIX DOC-CONTRACT-OS-1B1 défaut 1 (revue Vincent 2026-09-28, migration 446) ──
// scope_key est lu exclusivement depuis contract_effect.scopeKey, jamais depuis
// contract_effect.scope (texte libre humain, ex. « Zone Z2, sanitaires »).
describe('scope_key exclusivement issu de scopeKey (fix défaut 1)', () => {
  it('NEW : scope texte libre ne fuit jamais dans scope_key', async () => {
    const proposalId = await makeQualifiedProposal(
      { effect: 'new', temporality: 'permanent', scope: 'frequency', startsOn: '2026-01-01' },
      { label: `${TAG} scope texte libre ne fuit pas` },
    )
    const { data, error } = await callRpc(proposalId, { category: 'other', kind: 'obligation', measurable: false })
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string }>)[0]

    const db = createAdminClient()
    const { data: effectRow } = await db
      .from('engagement_contract_effects')
      .select('scope_key')
      .eq('id', row.effect_id)
      .single()
    // scope_key retombe sur le défaut whole_engagement — jamais la valeur de scope.
    expect(effectRow).toMatchObject({ scope_key: 'whole_engagement' })
  })
})

// ─── FIX DOC-CONTRACT-OS-1B1 défaut 2 (revue Vincent 2026-09-28, migration 446) ──
// NEW/MODIFY exigent un ancrage temporel contractuel — startsOn qualifié en
// priorité, repli sur documents.effective_date sinon, refus propre si aucun
// des deux n'existe. Jamais applied_at. SUSPEND (exigence stricte, inchangée)
// et CONFIRM (aucun ancrage requis) sont déjà couverts ailleurs.
describe('ancrage temporel NEW/MODIFY — startsOn qualifié ou documents.effective_date (fix défaut 2)', () => {
  it('NEW permanent + startsOn qualifié → starts_on = startsOn', async () => {
    const proposalId = await makeQualifiedProposal(
      { effect: 'new', temporality: 'permanent', startsOn: '2026-03-01' },
      { label: `${TAG} new anchor startsOn` },
    )
    const { data, error } = await callRpc(proposalId, { category: 'other', kind: 'obligation', measurable: false })
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string }>)[0]

    const db = createAdminClient()
    const { data: effectRow } = await db
      .from('engagement_contract_effects').select('starts_on').eq('id', row.effect_id).single()
    expect(effectRow).toMatchObject({ starts_on: '2026-03-01' })
  })

  it('NEW permanent sans startsOn, document.effective_date renseignée → repli sur effective_date', async () => {
    const proposalId = await makeQualifiedProposal(
      { effect: 'new', temporality: 'permanent' },
      { label: `${TAG} new anchor fallback effective_date`, document_id: docWithEffectiveDateId },
    )
    const { data, error } = await callRpc(proposalId, { category: 'other', kind: 'obligation', measurable: false })
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string }>)[0]

    const db = createAdminClient()
    const { data: effectRow } = await db
      .from('engagement_contract_effects').select('starts_on').eq('id', row.effect_id).single()
    expect(effectRow).toMatchObject({ starts_on: '2026-11-15' })
  })

  it('NEW permanent sans startsOn ni effective_date → refusé, zéro écriture', async () => {
    const proposalId = await makeQualifiedProposal(
      { effect: 'new', temporality: 'permanent' },
      { label: `${TAG} new anchor refused` },
    )
    const { error } = await callRpc(proposalId, { category: 'other', kind: 'obligation', measurable: false })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/ancrage temporel/)

    const db = createAdminClient()
    const { count } = await db
      .from('engagements').select('id', { count: 'exact', head: true }).eq('short_label', `${TAG} new anchor refused`)
    expect(count).toBe(0)
  })

  it('MODIFY permanent + startsOn qualifié → starts_on = startsOn', async () => {
    const target = await insertEngagement({ short_label: `${TAG} modify anchor startsOn` })
    const proposalId = await makeQualifiedProposal({
      effect: 'modify', temporality: 'permanent', scopeKey: 'frequency', startsOn: '2026-04-01', targetEngagementId: target,
    })
    const { data, error } = await callRpc(proposalId, { effectPayload: { foo: 'bar' } })
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string }>)[0]

    const db = createAdminClient()
    const { data: effectRow } = await db
      .from('engagement_contract_effects').select('starts_on').eq('id', row.effect_id).single()
    expect(effectRow).toMatchObject({ starts_on: '2026-04-01' })
  })

  it('MODIFY permanent sans startsOn, document.effective_date renseignée → repli sur effective_date', async () => {
    const target = await insertEngagement({ short_label: `${TAG} modify anchor fallback` })
    const proposalId = await makeQualifiedProposal(
      { effect: 'modify', temporality: 'permanent', scopeKey: 'frequency', targetEngagementId: target },
      { document_id: docWithEffectiveDateId },
    )
    const { data, error } = await callRpc(proposalId, { effectPayload: { foo: 'bar' } })
    expect(error).toBeNull()
    const row = (data as Array<{ effect_id: string }>)[0]

    const db = createAdminClient()
    const { data: effectRow } = await db
      .from('engagement_contract_effects').select('starts_on').eq('id', row.effect_id).single()
    expect(effectRow).toMatchObject({ starts_on: '2026-11-15' })
  })

  it('MODIFY permanent sans startsOn ni effective_date → refusé, zéro écriture', async () => {
    const target = await insertEngagement({ short_label: `${TAG} modify anchor refused` })
    const proposalId = await makeQualifiedProposal({
      effect: 'modify', temporality: 'permanent', scopeKey: 'frequency', targetEngagementId: target,
    })
    const { error } = await callRpc(proposalId, { effectPayload: { foo: 'bar' } })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/ancrage temporel/)

    const db = createAdminClient()
    const { count } = await db
      .from('engagement_contract_effects').select('id', { count: 'exact', head: true }).eq('source_proposal_id', proposalId)
    expect(count).toBe(0)
  })
})

// ─── FIX DOC-CONTRACT-OS-1B1 défaut C (2e revue Vincent 2026-09-28, migration 447) ──
// Fail-closed multi-organisation étendu à la proposition et au document source,
// pour TOUS les effets y compris NEW — pas seulement à l'Engagement cible
// (déjà couvert par « refuse un rattachement cross-organisation », migration 446).
describe('fail-closed multi-org — proposition/document vs chantier (fix défaut C)', () => {
  it('NEW : proposition d’une autre organisation que le chantier cible → refusé, zéro écriture', async () => {
    const proposalId = await makeQualifiedProposal(
      { effect: 'new', temporality: 'permanent', startsOn: '2026-01-01' },
      { label: `${TAG} new proposal cross-org`, organization_id: otherOrgId },
    )
    const { error } = await callRpc(proposalId, { category: 'other', kind: 'obligation', measurable: false })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/[Pp]roposition.*organisation.*cross-org refusée/)

    const db = createAdminClient()
    const { count: engagementCount } = await db
      .from('engagements').select('id', { count: 'exact', head: true }).eq('short_label', `${TAG} new proposal cross-org`)
    expect(engagementCount).toBe(0)
    const { count: effectCount } = await db
      .from('engagement_contract_effects').select('id', { count: 'exact', head: true }).eq('source_proposal_id', proposalId)
    expect(effectCount).toBe(0)
  })

  it('NEW : document source d’une autre organisation que le chantier cible → refusé, zéro écriture', async () => {
    const proposalId = await makeQualifiedProposal(
      { effect: 'new', temporality: 'permanent' },
      { label: `${TAG} new document cross-org`, document_id: otherOrgDocId },
    )
    const { error } = await callRpc(proposalId, { category: 'other', kind: 'obligation', measurable: false })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/[Dd]ocument.*organisation.*cross-org refusée/)

    const db = createAdminClient()
    const { count: engagementCount } = await db
      .from('engagements').select('id', { count: 'exact', head: true }).eq('short_label', `${TAG} new document cross-org`)
    expect(engagementCount).toBe(0)
    const { count: effectCount } = await db
      .from('engagement_contract_effects').select('id', { count: 'exact', head: true }).eq('source_proposal_id', proposalId)
    expect(effectCount).toBe(0)
  })

  it('CONFIRM : proposition d’une autre organisation que le chantier cible → refusé avant la garde Engagement', async () => {
    const target = await insertEngagement({ short_label: `${TAG} confirm cross-org proposal` })
    const proposalId = await makeQualifiedProposal(
      { effect: 'confirm', temporality: 'permanent', targetEngagementId: target },
      { organization_id: otherOrgId },
    )
    const { error } = await callRpc(proposalId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/[Pp]roposition.*organisation.*cross-org refusée/)

    const db = createAdminClient()
    const { count } = await db
      .from('engagement_contract_effects').select('id', { count: 'exact', head: true }).eq('source_proposal_id', proposalId)
    expect(count).toBe(0)
  })
})
