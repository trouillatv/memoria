// Test d'INTÉGRATION (vraie Supabase) — DOC-CONTRACT-OS-1B4-B (mandat Vincent
// 2026-09-30, sur audit 1B4-A FINAL CLOSED). Couvre la couche d'accès
// generate/list/dismiss de lib/db/engagement-planning-impact-proposals.ts :
// autorisation M2B fail-closed, idempotence de génération (même fingerprint =
// pas de nouvelle ligne), création d'une nouvelle version si le contenu
// dérivé change, filtrage CONFIRM (jamais de proposition), lecture = dernière
// version par contract_effect_id + capacité calculée à la volée.
//
// NÉCESSITE la migration 448 (engagement_planning_impact_proposals) appliquée
// à la base cible — non exécuté tant que la migration n'a pas reçu son GO
// d'application séparé (doctrine §15/§25).
//
// Conventions reprises de resolve-contract-state-for-user.test.ts : proposals
// qualifiées + RPC materialize_engagement_contract_effect pour produire de
// vrais effets persistés, jamais un insert direct dans
// engagement_contract_effects.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  generatePlanningImpactProposalsForEngagement,
  listPlanningImpactProposalsForEngagement,
  dismissPlanningImpactProposal,
} from '@/lib/db/engagement-planning-impact-proposals'
import type {
  ModifyFrequencyPlanningImpactPayload,
  NewPlanningImpactPayload,
} from '@/lib/engagements/planning-impact-proposal'

const TAG = `__test_planning_impact_proposals_${Math.floor(Date.now() / 1000)}__`

let memberOrgId: string
let outsiderOrgId: string
let adminUserId: string
let clientId: string
let siteId: string
let outsiderClientId: string
let outsiderSiteId: string
let docId: string
let runId: string

let newEngagementId: string
let modifyEngagementId: string
let modifyNonPlanningEngagementId: string
let suspendEngagementId: string
let confirmOnlyEngagementId: string
let crossOrgEngagementId: string
let os15NewEngagementId: string
let os15ModifyEngagementId: string
let os15SuspendEngagementId: string

const currentUser = () => ({ id: adminUserId })

async function makeQualifiedProposal(contractEffect: Record<string, unknown>) {
  const db = createAdminClient()
  const { data: proposal, error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: memberOrgId,
      extraction_run_id: runId,
      document_id: docId,
      target_site_id: siteId,
      proposal_family: 'engagement',
      label: `${TAG} proposal`,
      source_excerpt: `${TAG} extrait source de la proposition`,
      review_status: 'accepted',
      source_payload: { contract_effect: contractEffect },
    })
    .select('id')
    .single()
  if (error) throw error
  const proposalId = (proposal as { id: string }).id

  const { data: evidence, error: evidenceError } = await db
    .from('document_extraction_evidence')
    .insert({ organization_id: memberOrgId, extraction_run_id: runId, document_id: docId, evidence_type: 'text_excerpt' })
    .select('id')
    .single()
  if (evidenceError) throw evidenceError
  const { error: linkError } = await db
    .from('document_proposal_evidence')
    .insert({ proposal_id: proposalId, evidence_id: (evidence as { id: string }).id, relation_type: 'source' })
  if (linkError) throw linkError

  return proposalId
}

async function materializeEffectWithPayload(
  proposalId: string,
  payload: Record<string, unknown>,
  newEngagementParams?: { category: string; kind: string; measurable: boolean },
) {
  const db = createAdminClient()
  const { data, error } = await db.rpc('materialize_engagement_contract_effect', {
    p_proposal_id: proposalId,
    p_user_id: adminUserId,
    p_category: newEngagementParams?.category ?? null,
    p_kind: newEngagementParams?.kind ?? null,
    p_measurable: newEngagementParams?.measurable ?? null,
    p_effect_payload: payload,
  })
  if (error) throw error
  return (data as Array<{ effect_id: string; engagement_id: string }>)[0]
}

async function insertEngagement(overrides: Record<string, unknown>) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('engagements')
    .insert({
      source_type: 'manual',
      source_excerpt: `${TAG} source excerpt`,
      category: 'other',
      short_label: `${TAG} engagement`,
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

  const { data: admin } = await db.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('Aucun user admin — seed requis')
  adminUserId = (admin as { id: string }).id

  memberOrgId = (await db.from('organizations').insert({ name: `${TAG}member_org` }).select('id').single()).data!.id as string
  outsiderOrgId = (await db.from('organizations').insert({ name: `${TAG}outsider_org` }).select('id').single()).data!.id as string

  const { error: membershipError } = await db.from('organization_memberships').insert({
    user_id: adminUserId,
    organization_id: memberOrgId,
    role: 'admin',
    status: 'active',
  })
  if (membershipError) throw membershipError

  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: memberOrgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: memberOrgId }).select('id').single()).data!.id as string
  outsiderClientId = (await db.from('clients').insert({ name: `${TAG}outsider_client`, organization_id: outsiderOrgId }).select('id').single()).data!.id as string
  outsiderSiteId = (await db.from('sites').insert({ name: `${TAG}outsider_site`, client_id: outsiderClientId, organization_id: outsiderOrgId }).select('id').single()).data!.id as string

  docId = (await db.from('documents').insert({ organization_id: memberOrgId, document_type: 'ordre_service', storage_path: `${TAG}/os.pdf`, filename: 'os.pdf' }).select('id').single()).data!.id as string
  runId = (await db.from('document_extraction_run').insert({ organization_id: memberOrgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string

  modifyEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} modify` })
  modifyNonPlanningEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} modify non planning` })
  confirmOnlyEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} confirm-only` })
  crossOrgEngagementId = await insertEngagement({ site_id: outsiderSiteId, organization_id: outsiderOrgId, short_label: `${TAG} cross-org` })
  os15ModifyEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} os15 modify` })

  // TEST_DEFECT corrigé (mandat DB INTEGRATION Vincent 2026-09-30) : pour
  // l'effet 'new', la RPC materialize_engagement_contract_effect (445, jamais
  // changé sur ce point) IGNORE targetEngagementId et crée systématiquement un
  // nouvel Engagement — elle exige aussi p_category/p_kind/p_measurable.
  // L'Engagement fondateur d'un scénario NEW/SUSPEND doit donc être
  // l'engagement_id RENVOYÉ par la RPC, jamais un id pré-créé séparément.
  const newProposal = await makeQualifiedProposal({
    effect: 'new',
    temporality: 'permanent',
    scope: 'whole_engagement',
    scopeKey: 'whole_engagement',
    startsOn: '2026-10-01',
  })
  const newResult = await materializeEffectWithPayload(
    newProposal,
    { cadence: { count: 1, period: 'week' } },
    { category: 'other', kind: 'obligation', measurable: false },
  )
  newEngagementId = newResult.engagement_id

  const modifyPermanentProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-01-01',
    targetEngagementId: modifyEngagementId,
  })
  // FIX 1B4-B (mandat Vincent 2026-09-30) : la pertinence Planning d'un MODIFY
  // sur `frequency` exige désormais une cadence structurée dans effect_payload
  // — une description seule ne suffit plus (cf. planning-impact-proposal.ts).
  await materializeEffectWithPayload(modifyPermanentProposal, {
    description: 'fréquence mensuelle',
    cadence: { count: 1, period: 'month' },
  })

  const modifyBoundedProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'bounded',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-12-01',
    endsOn: '2026-12-31',
    targetEngagementId: modifyEngagementId,
  })
  await materializeEffectWithPayload(modifyBoundedProposal, {
    description: 'fréquence hebdomadaire',
    cadence: { count: 1, period: 'week' },
  })

  // FIX 4 (mandat Vincent 2026-09-30) : MODIFY sur un scope_key hors
  // PLANNING_RELEVANT_MODIFY_SCOPE_KEYS est un effet contractuel réel mais ne
  // doit produire AUCUNE proposition d'impact Planning.
  const modifyNonPlanningProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'quantity',
    scopeKey: 'quantity',
    startsOn: '2026-01-01',
    targetEngagementId: modifyNonPlanningEngagementId,
  })
  await materializeEffectWithPayload(modifyNonPlanningProposal, { description: '+10% de surface' })

  // OS15 — golden witness exact du mandat FIX_REQUIRED (2e revue Vincent
  // 2026-09-30) : NEW relevé photo hebdomadaire, 2026-12-01 → 2027-01-31.
  const os15NewProposal = await makeQualifiedProposal({
    effect: 'new',
    temporality: 'bounded',
    scope: 'reporting',
    scopeKey: 'reporting',
    startsOn: '2026-12-01',
    endsOn: '2027-01-31',
  })
  const os15NewResult = await materializeEffectWithPayload(
    os15NewProposal,
    { description: 'Relevé photo hebdomadaire zone Z2', cadence: { count: 1, period: 'week' } },
    { category: 'other', kind: 'obligation', measurable: false },
  )
  os15NewEngagementId = os15NewResult.engagement_id

  // OS15 — golden witness MODIFY : 2 passages/semaine → 3 passages/semaine au
  // 2026-12-01 ("from" resolu depuis l'effet permanent antérieur).
  const os15ModifyPriorProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-11-01',
    targetEngagementId: os15ModifyEngagementId,
  })
  await materializeEffectWithPayload(os15ModifyPriorProposal, {
    description: '2 passages par semaine',
    cadence: { count: 2, period: 'week' },
  })

  const os15ModifyProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-12-01',
    targetEngagementId: os15ModifyEngagementId,
  })
  await materializeEffectWithPayload(os15ModifyProposal, {
    description: 'passage de 2 à 3 passages par semaine',
    cadence: { count: 3, period: 'week' },
  })

  // OS15 — golden witness SUSPEND : cadence connue au 2026-12-09 (fondation
  // NEW structurée antérieure), SUSPEND 2026-12-10 → 2026-12-14, reprise
  // 2026-12-15 (mandat 1B4-B, règle 3 : la pertinence Planning d'un SUSPEND se
  // décide sur l'état contractuel de l'Engagement, jamais sur son propre
  // payload — cf. resolveContractCadenceAtDate).
  const os15SuspendFounderProposal = await makeQualifiedProposal({
    effect: 'new',
    temporality: 'permanent',
    scope: 'whole_engagement',
    scopeKey: 'whole_engagement',
    startsOn: '2026-01-01',
  })
  const os15SuspendFounderResult = await materializeEffectWithPayload(
    os15SuspendFounderProposal,
    { cadence: { count: 2, period: 'week' } },
    { category: 'other', kind: 'obligation', measurable: false },
  )
  os15SuspendEngagementId = os15SuspendFounderResult.engagement_id

  const os15SuspendProposal = await makeQualifiedProposal({
    effect: 'suspend',
    temporality: 'bounded',
    scope: 'whole_engagement',
    scopeKey: 'whole_engagement',
    startsOn: '2026-12-10',
    endsOn: '2026-12-14',
    resumeOn: '2026-12-15',
    targetEngagementId: os15SuspendEngagementId,
  })
  await materializeEffectWithPayload(os15SuspendProposal, {})

  const suspendFounderProposal = await makeQualifiedProposal({
    effect: 'new',
    temporality: 'permanent',
    scope: 'whole_engagement',
    scopeKey: 'whole_engagement',
    startsOn: '2026-01-01',
  })
  const suspendFounderResult = await materializeEffectWithPayload(
    suspendFounderProposal,
    { cadence: { count: 2, period: 'week' } },
    { category: 'other', kind: 'obligation', measurable: false },
  )
  suspendEngagementId = suspendFounderResult.engagement_id

  const suspendProposal = await makeQualifiedProposal({
    effect: 'suspend',
    temporality: 'bounded',
    scope: 'whole_engagement',
    scopeKey: 'whole_engagement',
    startsOn: '2026-08-01',
    endsOn: '2026-09-01',
    resumeOn: '2026-09-15',
    targetEngagementId: suspendEngagementId,
  })
  await materializeEffectWithPayload(suspendProposal, {})

  const confirmProposal = await makeQualifiedProposal({
    effect: 'confirm',
    temporality: 'permanent',
    scope: 'whole_engagement',
    scopeKey: 'whole_engagement',
    startsOn: '2026-01-01',
    targetEngagementId: confirmOnlyEngagementId,
  })
  await materializeEffectWithPayload(confirmProposal, {})
}, 30000)

afterAll(async () => {
  const db = createAdminClient()
  // engagements cascade → engagement_contract_effects → engagement_planning_impact_proposals
  await db.from('engagements').delete().in('id', [newEngagementId, modifyEngagementId, modifyNonPlanningEngagementId, suspendEngagementId, confirmOnlyEngagementId, crossOrgEngagementId, os15NewEngagementId, os15ModifyEngagementId, os15SuspendEngagementId])
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().in('id', [siteId, outsiderSiteId])
  await db.from('clients').delete().in('id', [clientId, outsiderClientId])
  await db.from('organization_memberships').delete().eq('user_id', adminUserId).eq('organization_id', memberOrgId)
  await db.from('organizations').delete().in('id', [memberOrgId, outsiderOrgId])
})

describe('generatePlanningImpactProposalsForEngagement — génération', () => {
  it('NEW — produit une proposition operation=new, aucune donnée Planning', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(newEngagementId, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]).toMatchObject({
      impactKind: 'new',
      status: 'proposed',
      proposalVersion: 1,
      proposalPayload: {
        operation: 'new',
        temporality: 'permanent',
        effectiveFrom: '2026-10-01',
        effectiveTo: null,
        cadence: { count: 1, period: 'week' },
      },
    })
  })

  it('MODIFY — deux effets produisent deux propositions distinctes, "fromCadence" résolu depuis l\'historique', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(modifyEngagementId, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposals).toHaveLength(2)
    const bounded = result.proposals.find(
      (p) =>
        p.proposalPayload.operation === 'change_frequency' &&
        (p.proposalPayload as ModifyFrequencyPlanningImpactPayload).effectiveFrom === '2026-12-01',
    )
    expect(bounded).toBeTruthy()
    const boundedPayload = bounded!.proposalPayload as ModifyFrequencyPlanningImpactPayload
    expect(boundedPayload.fromCadence).toEqual({ count: 1, period: 'month' })
    expect(boundedPayload.toCadence).toEqual({ count: 1, period: 'week' })
  })

  it('MODIFY sur scope_key non Planning-relevant (quantity) — aucune proposition générée (FIX 4)', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(modifyNonPlanningEngagementId, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposals).toHaveLength(0)
  })

  it('SUSPEND — produit une proposition operation=suspend avec resumeOn', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(suspendEngagementId, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Fondation NEW structurée (cadence 2/semaine) sur ce même Engagement produit
    // elle-même une proposition operation=new distincte (cf. fix TEST_DEFECT
    // ci-dessus) — le témoin ne porte que sur la proposition operation=suspend.
    const suspend = result.proposals.find((p) => p.proposalPayload.operation === 'suspend')
    expect(suspend).toBeTruthy()
    expect(suspend!.proposalPayload).toEqual({
      operation: 'suspend',
      effectiveFrom: '2026-08-01',
      effectiveTo: '2026-09-01',
      resumeOn: '2026-09-15',
      priorCadence: { count: 2, period: 'week' },
    })
  })

  it('CONFIRM seul — aucune proposition générée (doctrine 8)', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(confirmOnlyEngagementId, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposals).toHaveLength(0)
  })

  it('idempotence — regénérer sans changement ne crée aucune nouvelle ligne (même fingerprint, même version)', async () => {
    const first = await generatePlanningImpactProposalsForEngagement(newEngagementId, currentUser())
    const second = await generatePlanningImpactProposalsForEngagement(newEngagementId, currentUser())
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.proposals).toHaveLength(1)
    expect(second.proposals[0].id).toBe(first.proposals[0].id)
    expect(second.proposals[0].proposalVersion).toBe(first.proposals[0].proposalVersion)
    expect(second.proposals[0].proposalFingerprint).toBe(first.proposals[0].proposalFingerprint)
  })

  it('regénérer après dismissed ne réécrit pas le statut de la décision humaine', async () => {
    const generated = await generatePlanningImpactProposalsForEngagement(suspendEngagementId, currentUser())
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    const dismissed = await dismissPlanningImpactProposal(generated.proposals[0].id, currentUser(), 'ne concerne pas ce chantier')
    expect(dismissed.ok).toBe(true)

    const regenerated = await generatePlanningImpactProposalsForEngagement(suspendEngagementId, currentUser())
    expect(regenerated.ok).toBe(true)
    if (!regenerated.ok) return
    expect(regenerated.proposals[0].status).toBe('dismissed')
    expect(regenerated.proposals[0].id).toBe(generated.proposals[0].id)
  })

  it('Engagement d\'une autre organisation : refusé', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(crossOrgEngagementId, currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('utilisateur non membre : refusé', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(newEngagementId, { id: randomUUID() })
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('id inexistant : refusé proprement', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(randomUUID(), currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })
})

describe('listPlanningImpactProposalsForEngagement — lecture', () => {
  it('rend la dernière version par contract_effect_id avec capacité calculée à la volée', async () => {
    await generatePlanningImpactProposalsForEngagement(modifyEngagementId, currentUser())
    const result = await listPlanningImpactProposalsForEngagement(modifyEngagementId, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposals).toHaveLength(2)
    for (const proposal of result.proposals) {
      expect(proposal.capability).toEqual({
        readiness: 'partially_representable',
        blockingReason: 'recurring_change_requires_mission_targeting',
        missingDecisions: ['cycle_planning_cible', 'occurrences_a_regenerer'],
      })
    }
  })

  it('Engagement d\'une autre organisation : refusé', async () => {
    const result = await listPlanningImpactProposalsForEngagement(crossOrgEngagementId, currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('id inexistant : refusé proprement', async () => {
    const result = await listPlanningImpactProposalsForEngagement(randomUUID(), currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('aucun oracle : id inexistant et Engagement cross-org rendent le même message externe', async () => {
    const nonexistent = await listPlanningImpactProposalsForEngagement(randomUUID(), currentUser())
    const crossOrg = await listPlanningImpactProposalsForEngagement(crossOrgEngagementId, currentUser())
    expect(nonexistent).toEqual(crossOrg)
  })
})

describe('dismissPlanningImpactProposal — décision humaine', () => {
  it('écarte une proposition proposed, horodate et attribue à l\'utilisateur', async () => {
    const generated = await generatePlanningImpactProposalsForEngagement(newEngagementId, currentUser())
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    const result = await dismissPlanningImpactProposal(generated.proposals[0].id, currentUser(), 'déjà planifié manuellement')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposal.status).toBe('dismissed')
    expect(result.proposal.dismissedBy).toBe(adminUserId)
    expect(result.proposal.dismissalReason).toBe('déjà planifié manuellement')
    expect(typeof result.proposal.dismissedAt).toBe('string')
  })

  it('idempotent — écarter deux fois ne modifie ni la raison ni l\'horodatage initial', async () => {
    const generated = await generatePlanningImpactProposalsForEngagement(suspendEngagementId, currentUser())
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    const proposalId = generated.proposals[0].id
    const first = await dismissPlanningImpactProposal(proposalId, currentUser(), 'raison initiale')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = await dismissPlanningImpactProposal(proposalId, currentUser(), 'raison différente ignorée')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.proposal.dismissalReason).toBe(first.proposal.dismissalReason)
    expect(second.proposal.dismissedAt).toBe(first.proposal.dismissedAt)
  })

  it('id inexistant : refusé proprement, sans oracle (FIX 1)', async () => {
    const result = await dismissPlanningImpactProposal(randomUUID(), currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('utilisateur non membre de l\'organisation ne peut pas écarter la proposition', async () => {
    const generated = await generatePlanningImpactProposalsForEngagement(newEngagementId, currentUser())
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    const result = await dismissPlanningImpactProposal(generated.proposals[0].id, { id: randomUUID() })
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('aucun oracle : id inexistant et proposition réelle inaccessible rendent le même message externe (FIX 1)', async () => {
    const generated = await generatePlanningImpactProposalsForEngagement(newEngagementId, currentUser())
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    const nonexistent = await dismissPlanningImpactProposal(randomUUID(), { id: randomUUID() })
    const realButUnauthorized = await dismissPlanningImpactProposal(generated.proposals[0].id, { id: randomUUID() })
    expect(nonexistent).toEqual(realButUnauthorized)
  })
})

// OS15 — véritable témoin de fermeture DOC-CONTRACT-OS-1B4-B (mandat GO
// Vincent 2026-09-30, structured planning relevance), volet intégration.
// Reprend en base réelle le golden witness exact (NEW relevé photo
// hebdomadaire 2026-12-01→2027-01-31 ; MODIFY 2→3 passages/semaine au
// 2026-12-01 ; SUSPEND 2026-12-10→2026-12-14 reprise 2026-12-15, cadence
// connue au 2026-12-09 via une fondation NEW structurée ; CONFIRM sans
// impact). La pertinence Planning et le contenu structuré de chaque
// proposition dérivent EXCLUSIVEMENT de `effect_payload.cadence` — jamais de
// `description`/`frequency_raw`/`source_excerpt`/`label`.
describe('OS15 — véritable témoin de fermeture 1B4-B (golden witness, intégration)', () => {
  it('1. MODIFY — 2 à 3 passages/semaine au 2026-12-01 : partially_representable', async () => {
    const generated = await generatePlanningImpactProposalsForEngagement(os15ModifyEngagementId, currentUser())
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    const golden = generated.proposals.find(
      (p) => (p.proposalPayload as ModifyFrequencyPlanningImpactPayload).effectiveFrom === '2026-12-01',
    )
    expect(golden).toBeTruthy()
    const payload = golden!.proposalPayload as ModifyFrequencyPlanningImpactPayload
    expect(payload.fromCadence).toEqual({ count: 2, period: 'week' })
    expect(payload.toCadence).toEqual({ count: 3, period: 'week' })

    const listed = await listPlanningImpactProposalsForEngagement(os15ModifyEngagementId, currentUser())
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const listedGolden = listed.proposals.find(
      (p) => (p.proposalPayload as ModifyFrequencyPlanningImpactPayload).effectiveFrom === '2026-12-01',
    )
    expect(listedGolden!.capability.readiness).toBe('partially_representable')
  })

  it('2. SUSPEND — 2026-12-10 → 2026-12-14, reprise 2026-12-15 : blocked_by_planning_model', async () => {
    const generated = await generatePlanningImpactProposalsForEngagement(os15SuspendEngagementId, currentUser())
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    // Fondation NEW structurée (cadence 2/semaine) sur ce même Engagement
    // produit elle-même une proposition operation=new distincte — la RPC crée
    // désormais réellement les deux effets sur le même Engagement (fix
    // TEST_DEFECT ci-dessus), le témoin ne porte que sur la proposition
    // operation=suspend.
    const suspend = generated.proposals.find((p) => p.proposalPayload.operation === 'suspend')
    expect(suspend).toBeTruthy()
    expect(suspend!.proposalPayload).toEqual({
      operation: 'suspend',
      effectiveFrom: '2026-12-10',
      effectiveTo: '2026-12-14',
      resumeOn: '2026-12-15',
      priorCadence: { count: 2, period: 'week' },
    })
    const listed = await listPlanningImpactProposalsForEngagement(os15SuspendEngagementId, currentUser())
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const listedSuspend = listed.proposals.find((p) => p.proposalPayload.operation === 'suspend')
    expect(listedSuspend!.capability.readiness).toBe('blocked_by_planning_model')
  })

  it('3. NEW — relevé photo hebdomadaire 2026-12-01→2027-01-31 : partially_representable, cadence structurée jamais dérivée de la description', async () => {
    const generated = await generatePlanningImpactProposalsForEngagement(os15NewEngagementId, currentUser())
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    expect(generated.proposals).toHaveLength(1)
    const payload = generated.proposals[0].proposalPayload as NewPlanningImpactPayload
    expect(payload.effectiveFrom).toBe('2026-12-01')
    expect(payload.effectiveTo).toBe('2027-01-31')
    expect(payload.cadence).toEqual({ count: 1, period: 'week' })
    expect(payload.scopeKey).toBe('reporting')

    const listed = await listPlanningImpactProposalsForEngagement(os15NewEngagementId, currentUser())
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.proposals[0].capability.readiness).toBe('partially_representable')
    expect(listed.proposals[0].capability.blockingReason).toBe('new_requires_human_scheduling')
  })

  it('4. CONFIRM — jamais un impact Planning, aucune proposition générée', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(confirmOnlyEngagementId, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposals).toHaveLength(0)
  })
})

// PREUVES PERMANENTES DB INTEGRATION (mandat Vincent 2026-09-30, sur revue des
// probes jetables 1B4-B) — la revue a relevé que les témoins existants ne
// démontrent jamais une VRAIE bascule de version sur UN SEUL et même
// contract_effect_id (seulement deux effets différents), et que la contrainte
// UNIQUE (contract_effect_id, proposal_version) n'était vérifiée que par un
// script jetable. Les 4 preuves ci-dessous ferment ces deux trous, en base
// réelle, de façon permanente.

describe('PROOF 1 — réelle bascule de version sur UN SEUL contract_effect_id (mandat DB INTEGRATION 1B4-B)', () => {
  let proof1EngagementId: string
  let proof1ModifyEffectId: string

  beforeAll(async () => {
    // Fondation NEW structurée (cadence 1/jour) au 2026-01-01.
    const founderProposal = await makeQualifiedProposal({
      effect: 'new',
      temporality: 'permanent',
      scope: 'whole_engagement',
      scopeKey: 'whole_engagement',
      startsOn: '2026-01-01',
    })
    const founderResult = await materializeEffectWithPayload(
      founderProposal,
      { cadence: { count: 1, period: 'day' } },
      { category: 'other', kind: 'obligation', measurable: false },
    )
    proof1EngagementId = founderResult.engagement_id

    // Effet CIBLE, unique tout du long : MODIFY frequency au 2026-06-01.
    const modifyProposal = await makeQualifiedProposal({
      effect: 'modify',
      temporality: 'permanent',
      scope: 'frequency',
      scopeKey: 'frequency',
      startsOn: '2026-06-01',
      targetEngagementId: proof1EngagementId,
    })
    const modifyResult = await materializeEffectWithPayload(modifyProposal, {
      description: 'fréquence mensuelle (PROOF 1)',
      cadence: { count: 1, period: 'month' },
    })
    proof1ModifyEffectId = modifyResult.effect_id
  }, 30000)

  afterAll(async () => {
    const db = createAdminClient()
    await db.from('engagements').delete().eq('id', proof1EngagementId)
  })

  it('v1 résout fromCadence depuis la fondation NEW ; l\'insertion réelle d\'un effet antécédent fait naître v2 pour LE MÊME contract_effect_id, v1 restant intacte', async () => {
    const db = createAdminClient()

    const v1result = await generatePlanningImpactProposalsForEngagement(proof1EngagementId, currentUser())
    expect(v1result.ok).toBe(true)
    if (!v1result.ok) return
    const v1 = v1result.proposals.find((p) => p.contractEffectId === proof1ModifyEffectId)
    expect(v1).toBeTruthy()
    expect(v1!.proposalVersion).toBe(1)
    const v1Payload = v1!.proposalPayload as ModifyFrequencyPlanningImpactPayload
    expect(v1Payload.fromCadence).toEqual({ count: 1, period: 'day' })
    expect(v1Payload.toCadence).toEqual({ count: 1, period: 'month' })
    const v1Id = v1!.id
    const v1Fingerprint = v1!.proposalFingerprint

    // Effet réellement matérialisé APRÈS coup, qui change la cadence
    // résolvable la veille du startsOn de l'effet cible — l'effet cible
    // lui-même n'est jamais touché.
    const antecedentProposal = await makeQualifiedProposal({
      effect: 'modify',
      temporality: 'permanent',
      scope: 'frequency',
      scopeKey: 'frequency',
      startsOn: '2026-05-01',
      targetEngagementId: proof1EngagementId,
    })
    await materializeEffectWithPayload(antecedentProposal, {
      description: 'fréquence bihebdomadaire (antécédent PROOF 1)',
      cadence: { count: 2, period: 'week' },
    })

    const v2result = await generatePlanningImpactProposalsForEngagement(proof1EngagementId, currentUser())
    expect(v2result.ok).toBe(true)
    if (!v2result.ok) return
    const v2 = v2result.proposals.find((p) => p.contractEffectId === proof1ModifyEffectId)
    expect(v2).toBeTruthy()
    expect(v2!.proposalVersion).toBe(2)
    const v2Payload = v2!.proposalPayload as ModifyFrequencyPlanningImpactPayload
    expect(v2Payload.fromCadence).toEqual({ count: 2, period: 'week' })
    expect(v2Payload.toCadence).toEqual({ count: 1, period: 'month' })
    expect(v2!.proposalFingerprint).not.toBe(v1Fingerprint)

    // Deux lignes réelles persistent pour LE MÊME contract_effect_id ; la
    // ligne v1 n'est ni réécrite ni supprimée.
    const { data: rows, error } = await db
      .from('engagement_planning_impact_proposals')
      .select('id, proposal_version, proposal_fingerprint, proposal_payload')
      .eq('contract_effect_id', proof1ModifyEffectId)
      .order('proposal_version', { ascending: true })
    expect(error).toBeNull()
    expect(rows).toHaveLength(2)
    const persistedV1 = (rows as Array<{ id: string; proposal_version: number; proposal_fingerprint: string; proposal_payload: unknown }>).find(
      (r) => r.proposal_version === 1,
    )
    const persistedV2 = (rows as Array<{ id: string; proposal_version: number }>).find((r) => r.proposal_version === 2)
    expect(persistedV1!.id).toBe(v1Id)
    expect(persistedV1!.proposal_fingerprint).toBe(v1Fingerprint)
    expect(persistedV1!.proposal_payload).toEqual(v1Payload)
    expect(persistedV2!.id).toBe(v2!.id)

    // La lecture ne rend QUE la dernière version pour ce contract_effect_id.
    const listed = await listPlanningImpactProposalsForEngagement(proof1EngagementId, currentUser())
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const listedForEffect = listed.proposals.filter((p) => p.contractEffectId === proof1ModifyEffectId)
    expect(listedForEffect).toHaveLength(1)
    expect(listedForEffect[0].proposalVersion).toBe(2)
  })
})

describe('PROOF 2 — NEW réel sans cadence structurée en base : aucune proposition (mandat DB INTEGRATION 1B4-B)', () => {
  let proof2EngagementId: string

  beforeAll(async () => {
    const proposal = await makeQualifiedProposal({
      effect: 'new',
      temporality: 'permanent',
      scope: 'whole_engagement',
      scopeKey: 'whole_engagement',
      startsOn: '2026-07-01',
    })
    const result = await materializeEffectWithPayload(
      proposal,
      { description: 'obligation décrite en texte libre, sans cadence structurée (PROOF 2)' },
      { category: 'other', kind: 'obligation', measurable: false },
    )
    proof2EngagementId = result.engagement_id
  }, 30000)

  afterAll(async () => {
    const db = createAdminClient()
    await db.from('engagements').delete().eq('id', proof2EngagementId)
  })

  it('aucune proposition générée pour un effet NEW réellement matérialisé sans cadence', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(proof2EngagementId, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposals).toHaveLength(0)
  })
})

describe('PROOF 3 — SUSPEND réel sans cadence structurée résolvable dans l\'historique : aucune proposition (mandat DB INTEGRATION 1B4-B)', () => {
  let proof3EngagementId: string

  beforeAll(async () => {
    const founderProposal = await makeQualifiedProposal({
      effect: 'new',
      temporality: 'permanent',
      scope: 'whole_engagement',
      scopeKey: 'whole_engagement',
      startsOn: '2026-01-01',
    })
    const founderResult = await materializeEffectWithPayload(
      founderProposal,
      { description: 'engagement matérialisé sans aucune cadence structurée (PROOF 3)' },
      { category: 'other', kind: 'obligation', measurable: false },
    )
    proof3EngagementId = founderResult.engagement_id

    const suspendProposal = await makeQualifiedProposal({
      effect: 'suspend',
      temporality: 'bounded',
      scope: 'whole_engagement',
      scopeKey: 'whole_engagement',
      startsOn: '2026-12-10',
      endsOn: '2026-12-14',
      resumeOn: '2026-12-15',
      targetEngagementId: proof3EngagementId,
    })
    // Jamais de cadence dans le payload du SUSPEND lui-même (mandat 1B4-B, règle 3).
    await materializeEffectWithPayload(suspendProposal, {})
  }, 30000)

  afterAll(async () => {
    const db = createAdminClient()
    await db.from('engagements').delete().eq('id', proof3EngagementId)
  })

  it('aucune proposition SUSPEND générée : aucune cadence structurée résolvable dans l\'historique', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(proof3EngagementId, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const suspend = result.proposals.find((p) => p.proposalPayload.operation === 'suspend')
    expect(suspend).toBeUndefined()
  })
})

describe('PROOF 4 — contrainte DB permanente engagement_planning_impact_proposals_effect_version_unique (mandat DB INTEGRATION 1B4-B)', () => {
  it('un second insert au même (contract_effect_id, proposal_version) mais fingerprint différent est refusé par PostgreSQL (23505)', async () => {
    const db = createAdminClient()

    const proposal = await makeQualifiedProposal({
      effect: 'new',
      temporality: 'permanent',
      scope: 'whole_engagement',
      scopeKey: 'whole_engagement',
      startsOn: '2026-08-01',
    })
    const result = await materializeEffectWithPayload(
      proposal,
      { cadence: { count: 1, period: 'week' } },
      { category: 'other', kind: 'obligation', measurable: false },
    )
    const effectId = result.effect_id
    const engagementId = result.engagement_id

    try {
      const first = await db
        .from('engagement_planning_impact_proposals')
        .insert({
          organization_id: memberOrgId,
          engagement_id: engagementId,
          contract_effect_id: effectId,
          impact_kind: 'new',
          proposal_payload: { operation: 'new', probe: 'proof4-1' },
          proposal_fingerprint: `${TAG}proof4fp1`,
          proposal_version: 999,
        })
        .select('id')
      expect(first.error).toBeNull()

      const second = await db
        .from('engagement_planning_impact_proposals')
        .insert({
          organization_id: memberOrgId,
          engagement_id: engagementId,
          contract_effect_id: effectId,
          impact_kind: 'new',
          proposal_payload: { operation: 'new', probe: 'proof4-2' },
          proposal_fingerprint: `${TAG}proof4fp2`,
          proposal_version: 999,
        })
        .select('id')
      expect(second.error).toBeTruthy()
      expect(second.error!.code).toBe('23505')
      expect(second.error!.message).toMatch(/engagement_planning_impact_proposals_effect_version_unique/)
    } finally {
      await db.from('engagements').delete().eq('id', engagementId)
    }
  })
})
