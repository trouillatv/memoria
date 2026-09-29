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
import type { ModifyPlanningImpactPayload, NewPlanningImpactPayload } from '@/lib/engagements/planning-impact-proposal'

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

async function materializeEffectWithPayload(proposalId: string, payload: Record<string, unknown>) {
  const db = createAdminClient()
  const { data, error } = await db.rpc('materialize_engagement_contract_effect', {
    p_proposal_id: proposalId,
    p_user_id: adminUserId,
    p_category: null,
    p_kind: null,
    p_measurable: null,
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

  newEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} new` })
  modifyEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} modify` })
  modifyNonPlanningEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} modify non planning` })
  suspendEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} suspend` })
  confirmOnlyEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} confirm-only` })
  crossOrgEngagementId = await insertEngagement({ site_id: outsiderSiteId, organization_id: outsiderOrgId, short_label: `${TAG} cross-org` })
  os15NewEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} os15 new` })

  const newProposal = await makeQualifiedProposal({
    effect: 'new',
    temporality: 'permanent',
    scope: 'whole_engagement',
    scopeKey: 'whole_engagement',
    startsOn: '2026-10-01',
    targetEngagementId: newEngagementId,
  })
  await materializeEffectWithPayload(newProposal, {})

  const modifyPermanentProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-01-01',
    targetEngagementId: modifyEngagementId,
  })
  // effect_payload réel : toujours { description: <texte libre> } — jamais de
  // champ structuré (cf. review-actions.ts, aucune structure générique).
  await materializeEffectWithPayload(modifyPermanentProposal, { description: 'fréquence mensuelle' })

  const modifyBoundedProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'bounded',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-12-01',
    targetEngagementId: modifyEngagementId,
  })
  await materializeEffectWithPayload(modifyBoundedProposal, { description: 'fréquence hebdomadaire' })

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

  // OS15 — NEW qualifié avec une valeur métier riche (FIX 5).
  const os15NewProposal = await makeQualifiedProposal({
    effect: 'new',
    temporality: 'permanent',
    scope: 'whole_engagement',
    scopeKey: 'whole_engagement',
    startsOn: '2026-10-01',
    targetEngagementId: os15NewEngagementId,
  })
  await materializeEffectWithPayload(os15NewProposal, { description: 'Relevé photo hebdomadaire zone Z2' })

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
})

afterAll(async () => {
  const db = createAdminClient()
  // engagements cascade → engagement_contract_effects → engagement_planning_impact_proposals
  await db.from('engagements').delete().in('id', [newEngagementId, modifyEngagementId, modifyNonPlanningEngagementId, suspendEngagementId, confirmOnlyEngagementId, crossOrgEngagementId, os15NewEngagementId])
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
      proposalPayload: { operation: 'new', temporality: 'permanent', effectiveFrom: '2026-10-01', effectiveTo: null },
    })
  })

  it('MODIFY — deux effets produisent deux propositions distinctes, "from" résolu depuis l\'historique', async () => {
    const result = await generatePlanningImpactProposalsForEngagement(modifyEngagementId, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposals).toHaveLength(2)
    const bounded = result.proposals.find(
      (p) => p.proposalPayload.operation === 'change_frequency' && (p.proposalPayload as ModifyPlanningImpactPayload).effectiveFrom === '2026-12-01',
    )
    expect(bounded).toBeTruthy()
    const boundedPayload = bounded!.proposalPayload as ModifyPlanningImpactPayload
    expect(boundedPayload.from).toEqual({ description: 'fréquence mensuelle' })
    expect(boundedPayload.to).toEqual({ description: 'fréquence hebdomadaire' })
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
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].proposalPayload).toEqual({
      operation: 'suspend',
      effectiveFrom: '2026-08-01',
      effectiveTo: '2026-09-01',
      resumeOn: '2026-09-15',
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

// OS15 — témoin de fermeture DOC-CONTRACT-OS-1B4-B (mandat FIX_REQUIRED
// Vincent 2026-09-30), volet intégration. Couvre en base réelle ce que le
// test pur (planning-impact-proposal.test.ts) couvre en mémoire : NEW porte
// une qualification humaine riche (problème 5) sans jamais devenir
// applicable (problème 3), et le calcul de capacité lu par
// listPlanningImpactProposalsForEngagement reflète bien le nouveau modèle.
describe('OS15 — témoin de fermeture 1B4-B (intégration)', () => {
  it('NEW qualifié avec effect_payload riche : la proposition le porte, la capacité reste no_application', async () => {
    const generated = await generatePlanningImpactProposalsForEngagement(os15NewEngagementId, currentUser())
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    expect(generated.proposals).toHaveLength(1)
    const payload = generated.proposals[0].proposalPayload as NewPlanningImpactPayload
    expect(payload.effectPayload).toEqual({ description: 'Relevé photo hebdomadaire zone Z2' })
    expect(payload.scopeKey).toBe('whole_engagement')

    const listed = await listPlanningImpactProposalsForEngagement(os15NewEngagementId, currentUser())
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.proposals[0].capability.readiness).toBe('no_application')
    expect(listed.proposals[0].capability.blockingReason).toBe('new_requires_human_scheduling')
  })
})
