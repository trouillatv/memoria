// Test d'INTÉGRATION (vraie Supabase) — DOC-CONTRACT-OS-1B4-C1 (GO Vincent
// 2026-09-30, sur audit 1B4-A/B0/B FINAL CLOSED, SHA c6864e85). Couvre
// intégralement lib/db/planning-impact-application-decisions.ts : résolution
// des cibles Planning candidates, aperçu READ-ONLY, cycle de vie de la
// décision humaine (draft → ready/cancelled, supersession), fraîcheur
// contractuelle et fraîcheur d'état Planning live. Migration 449
// (planning_impact_application_decisions) déjà appliquée à la base cible.
//
// Conventions reprises de engagement-planning-impact-proposals.test.ts
// (proposals qualifiées + RPC materialize_engagement_contract_effect) et de
// plan-integ-1-atomic-published-switch.test.ts (créations réelles de
// missions/cycles/templates). C1 = jamais d'écriture Planning réelle : les
// fonctions testées ici ne mutent que planning_impact_application_decisions,
// jamais missions/intervention_templates/planning_cycles (sauf les mutations
// de fixtures elles-mêmes, faites directement en base par ce test, pas par
// le module sous test).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  resolvePlanningTargetCandidatesForProposal,
  previewApplication,
  createDraftDecision,
  markDecisionReady,
  cancelDecision,
  listDecisionsForProposal,
} from '@/lib/db/planning-impact-application-decisions'
import {
  generatePlanningImpactProposalsForEngagement,
  dismissPlanningImpactProposal,
  type EngagementPlanningImpactProposalRow,
} from '@/lib/db/engagement-planning-impact-proposals'
import { createCycle, savePublishedCycleAtomic } from '@/lib/db/planning-cycles'
import { createTemplate } from '@/lib/db/intervention-templates'
import type {
  NewDecisionPayload,
  ModifyCycleDecisionPayload,
  ModifySimpleBlockedDecisionPayload,
  SuspendDecisionPayload,
} from '@/lib/engagements/planning-application-decision'

const TAG = `__test_planning_impact_application_decisions_${Math.floor(Date.now() / 1000)}__`

let memberOrgId: string
let outsiderOrgId: string
let adminUserId: string
let clientId: string
let siteId: string
let emptySiteId: string
let outsiderClientId: string
let outsiderSiteId: string
let docId: string
let runId: string
let teamId: string

let missionNewId: string
let missionModifyCycleId: string
let cycleModifyId: string
let missionModifySimpleId: string
let templateModifySimpleId: string
let missionSuspendSimpleId: string
let templateSuspendSimpleId: string
let missionSuspendCycleId: string
let cycleSuspendId: string
let missionStateDriftId: string
let cycleForStateDriftId: string
let missionCrossOrgId: string

let newEngagementId: string
let newPlaceholderEngagementId: string
let modifyOkEngagementId: string
let modifySimpleEngagementId: string
let modifyDismissEngagementId: string
let modifyStaleEngagementId: string
let suspendEngagementId: string
let suspendPlaceholderEngagementId: string
let stateDriftEngagementId: string
let emptySiteEngagementId: string
let emptySitePlaceholderEngagementId: string

const currentUser = () => ({ id: adminUserId })

async function makeQualifiedProposal(contractEffect: Record<string, unknown>, targetSiteId: string = siteId) {
  const db = createAdminClient()
  const { data: proposal, error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: memberOrgId,
      extraction_run_id: runId,
      document_id: docId,
      target_site_id: targetSiteId,
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

async function generateSingleProposal(engagementId: string): Promise<EngagementPlanningImpactProposalRow> {
  const result = await generatePlanningImpactProposalsForEngagement(engagementId, currentUser())
  if (!result.ok) throw new Error(`génération refusée: ${result.error}`)
  if (result.proposals.length !== 1) throw new Error(`attendu 1 proposition, obtenu ${result.proposals.length}`)
  return result.proposals[0]
}

function newPayload(
  missionId: string,
  proposalPayload: EngagementPlanningImpactProposalRow['proposalPayload'],
  dayOfWeek = 1,
): NewDecisionPayload {
  return {
    mutationKind: 'new',
    targetMissionId: missionId,
    targetSourceKind: null,
    targetTemplateId: null,
    targetCycleId: null,
    proposalPayload,
    draftSimpleTemplate: {
      missionId,
      frequency: 'weekly',
      slots: null,
      dayOfWeek,
      dayOfMonth: null,
      plannedStartHHMM: '08:00',
      plannedEndHHMM: '10:00',
      startsOn: '2026-10-01',
      endsOn: null,
    },
  }
}

function modifyCyclePayload(
  missionId: string,
  cycleId: string,
  proposalPayload: EngagementPlanningImpactProposalRow['proposalPayload'],
): ModifyCycleDecisionPayload {
  return {
    mutationKind: 'modify',
    targetMissionId: missionId,
    targetSourceKind: 'cycle',
    targetTemplateId: null,
    targetCycleId: cycleId,
    proposalPayload,
    draftCycleAfter: {
      missionId,
      cycleLengthWeeks: 1,
      anchorDate: '2026-06-01',
      startsOn: '2026-06-01',
      endsOn: null,
      slots: [{ weekIndex: 0, weekday: 2, teamId, state: 'work', startTime: '09:00', endTime: '13:00' }],
    },
  }
}

function modifySimplePayload(
  missionId: string,
  templateId: string,
  proposalPayload: EngagementPlanningImpactProposalRow['proposalPayload'],
): ModifySimpleBlockedDecisionPayload {
  return {
    mutationKind: 'modify',
    targetMissionId: missionId,
    targetSourceKind: 'simple',
    targetTemplateId: templateId,
    targetCycleId: null,
    proposalPayload,
  }
}

function suspendPayload(
  missionId: string,
  sourceKind: 'simple' | 'cycle',
  templateId: string | null,
  cycleId: string | null,
  proposalPayload: EngagementPlanningImpactProposalRow['proposalPayload'],
): SuspendDecisionPayload {
  return {
    mutationKind: 'suspend',
    targetMissionId: missionId,
    targetSourceKind: sourceKind,
    targetTemplateId: templateId,
    targetCycleId: cycleId,
    proposalPayload,
  }
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
  emptySiteId = (await db.from('sites').insert({ name: `${TAG}empty_site`, client_id: clientId, organization_id: memberOrgId }).select('id').single()).data!.id as string
  outsiderClientId = (await db.from('clients').insert({ name: `${TAG}outsider_client`, organization_id: outsiderOrgId }).select('id').single()).data!.id as string
  outsiderSiteId = (await db.from('sites').insert({ name: `${TAG}outsider_site`, client_id: outsiderClientId, organization_id: outsiderOrgId }).select('id').single()).data!.id as string

  docId = (await db.from('documents').insert({ organization_id: memberOrgId, document_type: 'ordre_service', storage_path: `${TAG}/os.pdf`, filename: 'os.pdf' }).select('id').single()).data!.id as string
  runId = (await db.from('document_extraction_run').insert({ organization_id: memberOrgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string

  teamId = (await db.from('teams').insert({ name: `${TAG}team`.slice(0, 50), organization_id: memberOrgId }).select('id').single()).data!.id as string

  const insertMission = async (name: string, orgId: string, site: string): Promise<string> =>
    (await db.from('missions').insert({ site_id: site, name, organization_id: orgId }).select('id').single()).data!.id as string

  missionNewId = await insertMission(`${TAG} mission new`, memberOrgId, siteId)
  missionModifyCycleId = await insertMission(`${TAG} mission modify cycle`, memberOrgId, siteId)
  missionModifySimpleId = await insertMission(`${TAG} mission modify simple`, memberOrgId, siteId)
  missionSuspendSimpleId = await insertMission(`${TAG} mission suspend simple`, memberOrgId, siteId)
  missionSuspendCycleId = await insertMission(`${TAG} mission suspend cycle`, memberOrgId, siteId)
  missionStateDriftId = await insertMission(`${TAG} mission state drift`, memberOrgId, siteId)
  missionCrossOrgId = await insertMission(`${TAG} mission cross org`, outsiderOrgId, outsiderSiteId)

  cycleModifyId = await createCycle({
    siteId,
    missionId: missionModifyCycleId,
    organizationId: memberOrgId,
    name: `${TAG} cycle modify`,
    cycleLengthWeeks: 1,
    anchorDate: '2026-01-05',
    startsOn: '2026-01-05',
    endsOn: null,
    slots: [{ weekIndex: 0, weekday: 1, teamId, state: 'work', startTime: '08:00', endTime: '12:00' }],
    userId: null,
    status: 'published',
  })

  cycleSuspendId = await createCycle({
    siteId,
    missionId: missionSuspendCycleId,
    organizationId: memberOrgId,
    name: `${TAG} cycle suspend`,
    cycleLengthWeeks: 1,
    anchorDate: '2026-01-05',
    startsOn: '2026-01-05',
    endsOn: null,
    slots: [{ weekIndex: 0, weekday: 1, teamId, state: 'work', startTime: '08:00', endTime: '12:00' }],
    userId: null,
    status: 'published',
  })

  cycleForStateDriftId = await createCycle({
    siteId,
    missionId: missionStateDriftId,
    organizationId: memberOrgId,
    name: `${TAG} cycle state drift`,
    cycleLengthWeeks: 1,
    anchorDate: '2026-01-05',
    startsOn: '2026-01-05',
    endsOn: null,
    slots: [{ weekIndex: 0, weekday: 1, teamId, state: 'work', startTime: '08:00', endTime: '12:00' }],
    userId: null,
    status: 'published',
  })

  const templateModify = await createTemplate({
    mission_id: missionModifySimpleId,
    title: `${TAG} simple modify`,
    frequency: 'weekly',
    day_of_week: 1,
    starts_on: '2026-01-01',
  })
  templateModifySimpleId = templateModify.id

  const templateSuspend = await createTemplate({
    mission_id: missionSuspendSimpleId,
    title: `${TAG} simple suspend`,
    frequency: 'weekly',
    day_of_week: 1,
    starts_on: '2026-01-01',
  })
  templateSuspendSimpleId = templateSuspend.id

  newPlaceholderEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} new` })
  modifyOkEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} modify ok` })
  modifySimpleEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} modify simple` })
  modifyDismissEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} modify dismiss` })
  modifyStaleEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} modify stale` })
  suspendPlaceholderEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} suspend` })
  stateDriftEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} state drift` })
  emptySitePlaceholderEngagementId = await insertEngagement({ site_id: emptySiteId, organization_id: memberOrgId, short_label: `${TAG} empty site` })

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
  // La RPC 'new' ignore l'Engagement pré-créé et en fabrique toujours un
  // nouveau (migration 447, INSERT INTO engagements ... RETURNING id INTO
  // v_target_engagement) — même TEST_DEFECT que suspendEngagementId/
  // emptySiteEngagementId ci-dessous, corrigé ici par la même reprise.
  newEngagementId = newResult.engagement_id

  const modifyOkProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-06-01',
    targetEngagementId: modifyOkEngagementId,
  })
  await materializeEffectWithPayload(modifyOkProposal, { description: 'fréquence mensuelle', cadence: { count: 1, period: 'month' } })

  const modifySimpleProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-06-01',
    targetEngagementId: modifySimpleEngagementId,
  })
  await materializeEffectWithPayload(modifySimpleProposal, { description: 'fréquence mensuelle', cadence: { count: 1, period: 'month' } })

  const modifyDismissProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-06-01',
    targetEngagementId: modifyDismissEngagementId,
  })
  await materializeEffectWithPayload(modifyDismissProposal, { description: 'fréquence mensuelle', cadence: { count: 1, period: 'month' } })

  const modifyStaleProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-06-01',
    targetEngagementId: modifyStaleEngagementId,
  })
  await materializeEffectWithPayload(modifyStaleProposal, { description: 'fréquence mensuelle', cadence: { count: 1, period: 'month' } })

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
  // La RPC 'new' ignore l'Engagement pré-créé et en fabrique un nouveau — le
  // fondateur structuré vit sur l'engagement RENVOYÉ, jamais suspendEngagementId
  // lui-même (cf. TEST_DEFECT documenté dans le sibling 1B4-B).
  const suspendFounderEngagementId = suspendFounderResult.engagement_id
  const suspendProposal = await makeQualifiedProposal({
    effect: 'suspend',
    temporality: 'bounded',
    scope: 'whole_engagement',
    scopeKey: 'whole_engagement',
    startsOn: '2026-08-01',
    endsOn: '2026-09-01',
    resumeOn: '2026-09-15',
    targetEngagementId: suspendFounderEngagementId,
  })
  await materializeEffectWithPayload(suspendProposal, {})
  suspendEngagementId = suspendFounderEngagementId

  const stateDriftProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-06-01',
    targetEngagementId: stateDriftEngagementId,
  })
  await materializeEffectWithPayload(stateDriftProposal, { description: 'fréquence mensuelle', cadence: { count: 1, period: 'month' } })

  const emptySiteProposal = await makeQualifiedProposal(
    {
      effect: 'new',
      temporality: 'permanent',
      scope: 'whole_engagement',
      scopeKey: 'whole_engagement',
      startsOn: '2026-10-01',
    },
    emptySiteId,
  )
  const emptySiteResult = await materializeEffectWithPayload(
    emptySiteProposal,
    { cadence: { count: 1, period: 'week' } },
    { category: 'other', kind: 'obligation', measurable: false },
  )
  emptySiteEngagementId = emptySiteResult.engagement_id
}, 60000)

afterAll(async () => {
  const db = createAdminClient()
  const allEngagementIds = [
    newEngagementId,
    newPlaceholderEngagementId,
    modifyOkEngagementId,
    modifySimpleEngagementId,
    modifyDismissEngagementId,
    modifyStaleEngagementId,
    suspendEngagementId,
    suspendPlaceholderEngagementId,
    stateDriftEngagementId,
    emptySiteEngagementId,
    emptySitePlaceholderEngagementId,
  ]
  // Nettoyage explicite AVANT la cascade engagements → au cas où la FK
  // engagement_id de planning_impact_application_decisions ne serait pas en
  // CASCADE : un afterAll qui échoue sur une contrainte masquerait le vrai
  // verdict des tests précédents.
  await db.from('planning_impact_application_decisions').delete().in('engagement_id', allEngagementIds)
  await db.from('planning_cycles').delete().eq('site_id', siteId)
  await db.from('intervention_templates').delete().in('id', [templateModifySimpleId, templateSuspendSimpleId])
  await db.from('engagements').delete().in('id', allEngagementIds)
  await db.from('missions').delete().in('site_id', [siteId, outsiderSiteId])
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().in('id', [siteId, emptySiteId, outsiderSiteId])
  await db.from('teams').delete().eq('id', teamId)
  await db.from('clients').delete().in('id', [clientId, outsiderClientId])
  await db.from('organization_memberships').delete().eq('user_id', adminUserId).eq('organization_id', memberOrgId)
  await db.from('organizations').delete().in('id', [memberOrgId, outsiderOrgId])
})

describe('resolvePlanningTargetCandidatesForProposal', () => {
  it("proposition NEW — Mission sans source prête (readiness=ready, sourceKind=null), Mission avec cycle publié bloquée (conflit)", async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await resolvePlanningTargetCandidatesForProposal(proposal.id, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const forNewMission = result.candidates.find((c) => c.missionId === missionNewId)
    expect(forNewMission).toMatchObject({ readiness: 'ready', sourceKind: null })
    const forCycleMission = result.candidates.find((c) => c.missionId === missionModifyCycleId)
    expect(forCycleMission).toMatchObject({ readiness: 'blocked_conflicting_source', sourceKind: 'cycle' })
  })

  it('proposition MODIFY — cycle publié prêt, rythme SIMPLE bloqué (supersession requise), aucune source bloquée', async () => {
    const proposal = await generateSingleProposal(modifyOkEngagementId)
    const result = await resolvePlanningTargetCandidatesForProposal(proposal.id, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.candidates.find((c) => c.missionId === missionModifyCycleId)).toMatchObject({ readiness: 'ready', sourceKind: 'cycle' })
    expect(result.candidates.find((c) => c.missionId === missionModifySimpleId)).toMatchObject({
      readiness: 'blocked_requires_simple_supersession',
      sourceKind: 'simple',
    })
    expect(result.candidates.find((c) => c.missionId === missionNewId)).toMatchObject({ readiness: 'blocked_no_target' })
  })

  it('proposition SUSPEND — rythme SIMPLE et cycle publié tous les deux prêts', async () => {
    // L'Engagement fondateur suspend porte 2 effets (new + suspend) : la
    // génération produit donc 2 propositions — generateSingleProposal (qui
    // exige exactement 1) ne s'applique pas ici, cf. commentaire de
    // listPlanningImpactProposalsForEngagementSuspend ci-dessous.
    const genResult = await generatePlanningImpactProposalsForEngagement(suspendEngagementId, currentUser())
    if (!genResult.ok) throw new Error(`génération refusée: ${genResult.error}`)
    const proposal = genResult.proposals.find((p) => p.proposalPayload.operation === 'suspend')
    expect(proposal).toBeTruthy()
    const result = await resolvePlanningTargetCandidatesForProposal(proposal!.id, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.candidates.find((c) => c.missionId === missionSuspendSimpleId)).toMatchObject({ readiness: 'ready', sourceKind: 'simple' })
    expect(result.candidates.find((c) => c.missionId === missionSuspendCycleId)).toMatchObject({ readiness: 'ready', sourceKind: 'cycle' })
  })

  it('site sans aucune Mission — candidates vide', async () => {
    const proposal = await generateSingleProposal(emptySiteEngagementId)
    const result = await resolvePlanningTargetCandidatesForProposal(proposal.id, currentUser())
    expect(result).toEqual({ ok: true, candidates: [] })
  })

  it('proposition inexistante : refusé', async () => {
    const result = await resolvePlanningTargetCandidatesForProposal(randomUUID(), currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('utilisateur non membre : refusé', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await resolvePlanningTargetCandidatesForProposal(proposal.id, { id: randomUUID() })
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })
})

// generateSingleProposal exige 1 seule proposition — l'Engagement fondateur
// suspend en produit 2 (new + suspend) ; ce helper isole la proposition
// operation=suspend pour les tests qui en ont besoin.
async function listPlanningImpactProposalsForEngagementSuspend() {
  const { listPlanningImpactProposalsForEngagement } = await import('@/lib/db/engagement-planning-impact-proposals')
  const result = await listPlanningImpactProposalsForEngagement(suspendEngagementId, currentUser())
  if (!result.ok) throw new Error('lecture refusée')
  return result.proposals
}

describe('previewApplication', () => {
  it('NEW — projette des occurrences dans la fenêtre demandée', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await previewApplication(
      { proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload), from: '2026-10-01', to: '2026-10-31' },
      currentUser(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('new')
    if (result.preview.kind !== 'new') return
    expect(result.preview.occurrences.length).toBeGreaterThan(0)
  })

  it("NEW — draftSimpleTemplate.missionId différent de targetMissionId : target_mission_mismatch", async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const payload = newPayload(missionNewId, proposal.proposalPayload)
    const mismatched = { ...payload, draftSimpleTemplate: { ...payload.draftSimpleTemplate, missionId: missionModifyCycleId } }
    const result = await previewApplication(
      { proposalId: proposal.id, decisionPayload: mismatched, from: '2026-10-01', to: '2026-10-31' },
      currentUser(),
    )
    expect(result).toEqual({ ok: false, error: 'target_mission_mismatch' })
  })

  it('mutationKind du payload différent de impactKind de la proposition : mutation_kind_mismatch', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await previewApplication(
      {
        proposalId: proposal.id,
        decisionPayload: suspendPayload(missionSuspendSimpleId, 'simple', templateSuspendSimpleId, null, proposal.proposalPayload),
        from: '2026-10-01',
        to: '2026-10-31',
      },
      currentUser(),
    )
    expect(result).toEqual({ ok: false, error: 'mutation_kind_mismatch' })
  })

  it('targetMissionId inexistant : target_not_found', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await previewApplication(
      { proposalId: proposal.id, decisionPayload: newPayload(randomUUID(), proposal.proposalPayload), from: '2026-10-01', to: '2026-10-31' },
      currentUser(),
    )
    expect(result).toEqual({ ok: false, error: 'target_not_found' })
  })

  it("Mission cible d'une autre organisation : target_organization_mismatch", async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await previewApplication(
      { proposalId: proposal.id, decisionPayload: newPayload(missionCrossOrgId, proposal.proposalPayload), from: '2026-10-01', to: '2026-10-31' },
      currentUser(),
    )
    expect(result).toEqual({ ok: false, error: 'target_organization_mismatch' })
  })

  it('MODIFY+cycle — expose une grille before/after avec liveStateFingerprint', async () => {
    const proposal = await generateSingleProposal(modifyOkEngagementId)
    const result = await previewApplication(
      {
        proposalId: proposal.id,
        decisionPayload: modifyCyclePayload(missionModifyCycleId, cycleModifyId, proposal.proposalPayload),
        from: '2026-06-01',
        to: '2026-06-14',
      },
      currentUser(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('modify_cycle')
    if (result.preview.kind !== 'modify_cycle') return
    expect(typeof result.preview.liveStateFingerprint).toBe('string')
    expect(result.preview.before).toBeTruthy()
    expect(result.preview.after).toBeTruthy()
  })

  it('MODIFY+cycle — targetCycleId inexistant : target_not_found', async () => {
    const proposal = await generateSingleProposal(modifyOkEngagementId)
    const result = await previewApplication(
      {
        proposalId: proposal.id,
        decisionPayload: modifyCyclePayload(missionModifyCycleId, randomUUID(), proposal.proposalPayload),
        from: '2026-06-01',
        to: '2026-06-14',
      },
      currentUser(),
    )
    expect(result).toEqual({ ok: false, error: 'target_not_found' })
  })

  it('MODIFY+simple — toujours modify_blocked_simple, quelle que soit la fenêtre', async () => {
    const proposal = await generateSingleProposal(modifySimpleEngagementId)
    const result = await previewApplication(
      {
        proposalId: proposal.id,
        decisionPayload: modifySimplePayload(missionModifySimpleId, templateModifySimpleId, proposal.proposalPayload),
        from: '2026-06-01',
        to: '2026-06-14',
      },
      currentUser(),
    )
    expect(result).toEqual({ ok: true, preview: { kind: 'modify_blocked_simple' } })
  })

  it('SUSPEND+simple — expose un résumé de classification matérialisé/projeté', async () => {
    const proposal = (await listPlanningImpactProposalsForEngagementSuspend()).find((p) => p.proposalPayload.operation === 'suspend')!
    const result = await previewApplication(
      {
        proposalId: proposal.id,
        decisionPayload: suspendPayload(missionSuspendSimpleId, 'simple', templateSuspendSimpleId, null, proposal.proposalPayload),
        from: '2026-08-01',
        to: '2026-08-14',
      },
      currentUser(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('suspend')
    if (result.preview.kind !== 'suspend') return
    expect(result.preview.summary).toBeTruthy()
  })

  it('SUSPEND+simple — targetTemplateId inexistant : target_not_found', async () => {
    const proposal = (await listPlanningImpactProposalsForEngagementSuspend()).find((p) => p.proposalPayload.operation === 'suspend')!
    const result = await previewApplication(
      {
        proposalId: proposal.id,
        decisionPayload: suspendPayload(missionSuspendSimpleId, 'simple', randomUUID(), null, proposal.proposalPayload),
        from: '2026-08-01',
        to: '2026-08-14',
      },
      currentUser(),
    )
    expect(result).toEqual({ ok: false, error: 'target_not_found' })
  })

  it('SUSPEND+cycle — expose un résumé de classification', async () => {
    const proposal = (await listPlanningImpactProposalsForEngagementSuspend()).find((p) => p.proposalPayload.operation === 'suspend')!
    const result = await previewApplication(
      {
        proposalId: proposal.id,
        decisionPayload: suspendPayload(missionSuspendCycleId, 'cycle', null, cycleSuspendId, proposal.proposalPayload),
        from: '2026-08-01',
        to: '2026-08-14',
      },
      currentUser(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('suspend')
  })

  it('proposition inexistante : refusé', async () => {
    const result = await previewApplication(
      { proposalId: randomUUID(), decisionPayload: newPayload(missionNewId, { operation: 'new' } as never), from: '2026-10-01', to: '2026-10-31' },
      currentUser(),
    )
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })
})

describe('createDraftDecision', () => {
  it('NEW — crée une décision draft, sans fingerprint d’état Planning', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload) }, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.decision).toMatchObject({
      status: 'draft',
      mutationKind: 'new',
      targetMissionId: missionNewId,
      planningImpactProposalId: proposal.id,
      planningStateFingerprint: null,
      supersedesDecisionId: null,
    })
    expect(typeof result.decision.applicationFingerprint).toBe('string')
  })

  it('supersession — un second draft sur la MÊME proposition marque le premier superseded et référence son id', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const first = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload, 2) }, currentUser())
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload, 3) }, currentUser())
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.decision.supersedesDecisionId).toBe(first.decision.id)

    const listed = await listDecisionsForProposal(proposal.id, currentUser())
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.decisions.find((d) => d.id === first.decision.id)?.status).toBe('superseded')
    expect(listed.decisions.find((d) => d.id === second.decision.id)?.status).toBe('draft')
  })

  it('duplicate_fingerprint — recréer un draft identique à une décision déjà annulée est refusé par la contrainte UNIQUE', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const payload = newPayload(missionNewId, proposal.proposalPayload, 4)
    const first = await createDraftDecision({ proposalId: proposal.id, decisionPayload: payload }, currentUser())
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const cancelled = await cancelDecision(first.decision.id, currentUser())
    expect(cancelled.ok).toBe(true)

    const duplicate = await createDraftDecision({ proposalId: proposal.id, decisionPayload: payload }, currentUser())
    expect(duplicate).toEqual({ ok: false, error: 'duplicate_fingerprint' })
  })

  it('mutation_kind_mismatch — payload suspend sur une proposition new', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await createDraftDecision(
      { proposalId: proposal.id, decisionPayload: suspendPayload(missionSuspendSimpleId, 'simple', templateSuspendSimpleId, null, proposal.proposalPayload) },
      currentUser(),
    )
    expect(result).toEqual({ ok: false, error: 'mutation_kind_mismatch' })
  })

  it('target_not_found — targetMissionId inexistant', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(randomUUID(), proposal.proposalPayload) }, currentUser())
    expect(result).toEqual({ ok: false, error: 'target_not_found' })
  })

  it("target_organization_mismatch — Mission d'une autre organisation", async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(missionCrossOrgId, proposal.proposalPayload) }, currentUser())
    expect(result).toEqual({ ok: false, error: 'target_organization_mismatch' })
  })

  it('proposition inexistante : refusé', async () => {
    const result = await createDraftDecision(
      { proposalId: randomUUID(), decisionPayload: newPayload(missionNewId, { operation: 'new' } as never) },
      currentUser(),
    )
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('utilisateur non membre : refusé', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const result = await createDraftDecision(
      { proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload) },
      { id: randomUUID() },
    )
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  // target_mission_mismatch : lu intégralement dans le corps de createDraftDecision
  // (mandat §15) — cette vérification n'existe QUE dans previewApplication (branche
  // 'new'), jamais dans createDraftDecision. Branche structurellement inatteignable
  // ici, jamais fabriquée artificiellement.
  it.skip('target_mission_mismatch — structurellement inatteignable dans createDraftDecision (vérifié par lecture du code, mandat §15)', () => {})

  // write_failed : seule issue non-23505 d'un insert dont toutes les FK/contraintes
  // ont déjà été validées par les étapes précédentes de la fonction (mission, cycle
  // ou template déjà résolus avec succès) — non reproductible sans mocker Supabase,
  // ce que ce fichier d'intégration exclut par construction (mandat §15).
  it.skip('write_failed — non reproductible sans mock Supabase (test d’intégration base réelle, mandat §15)', () => {})
})

describe('markDecisionReady', () => {
  it('ok — passe draft → ready, horodate, idempotent au second appel', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const draft = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload, 5) }, currentUser())
    expect(draft.ok).toBe(true)
    if (!draft.ok) return

    const first = await markDecisionReady(draft.decision.id, currentUser())
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.decision.status).toBe('ready')
    expect(typeof first.decision.readyAt).toBe('string')
    expect(first.decision.readyBy).toBe(adminUserId)

    const second = await markDecisionReady(draft.decision.id, currentUser())
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.decision.readyAt).toBe(first.decision.readyAt)
  })

  it('invalid_status_transition — décision déjà annulée', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const draft = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload, 6) }, currentUser())
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    const cancelled = await cancelDecision(draft.decision.id, currentUser())
    expect(cancelled.ok).toBe(true)

    const result = await markDecisionReady(draft.decision.id, currentUser())
    expect(result).toEqual({ ok: false, error: 'invalid_status_transition' })
  })

  it('blocked_requires_simple_supersession — cible MODIFY sur un rythme SIMPLE', async () => {
    const proposal = await generateSingleProposal(modifySimpleEngagementId)
    const draft = await createDraftDecision(
      { proposalId: proposal.id, decisionPayload: modifySimplePayload(missionModifySimpleId, templateModifySimpleId, proposal.proposalPayload) },
      currentUser(),
    )
    expect(draft.ok).toBe(true)
    if (!draft.ok) return

    const result = await markDecisionReady(draft.decision.id, currentUser())
    expect(result).toEqual({ ok: false, error: 'blocked_requires_simple_supersession' })
  })

  it('contract_dismissed — la proposition a été écartée depuis la création du draft', async () => {
    const proposal = await generateSingleProposal(modifyDismissEngagementId)
    const draft = await createDraftDecision(
      { proposalId: proposal.id, decisionPayload: modifyCyclePayload(missionModifyCycleId, cycleModifyId, proposal.proposalPayload) },
      currentUser(),
    )
    expect(draft.ok).toBe(true)
    if (!draft.ok) return

    const dismissed = await dismissPlanningImpactProposal(proposal.id, currentUser(), 'ne concerne plus ce chantier')
    expect(dismissed.ok).toBe(true)

    const result = await markDecisionReady(draft.decision.id, currentUser())
    expect(result).toEqual({ ok: false, error: 'contract_dismissed' })
  })

  it('contract_stale — la proposition a changé de version depuis la création du draft', async () => {
    const proposal = await generateSingleProposal(modifyStaleEngagementId)
    const draft = await createDraftDecision(
      { proposalId: proposal.id, decisionPayload: modifyCyclePayload(missionModifyCycleId, cycleModifyId, proposal.proposalPayload) },
      currentUser(),
    )
    expect(draft.ok).toBe(true)
    if (!draft.ok) return

    // Effet antécédent réel qui change la cadence résolvable pour l'effet
    // cible (même contract_effect_id) → nouvelle version de la proposition.
    const antecedentProposal = await makeQualifiedProposal({
      effect: 'modify',
      temporality: 'permanent',
      scope: 'frequency',
      scopeKey: 'frequency',
      startsOn: '2026-05-01',
      targetEngagementId: modifyStaleEngagementId,
    })
    await materializeEffectWithPayload(antecedentProposal, { description: 'fréquence bihebdomadaire', cadence: { count: 2, period: 'week' } })
    const regenerated = await generatePlanningImpactProposalsForEngagement(modifyStaleEngagementId, currentUser())
    expect(regenerated.ok).toBe(true)
    if (!regenerated.ok) return
    const bumped = regenerated.proposals.find((p) => p.contractEffectId === proposal.contractEffectId)
    expect(bumped!.proposalVersion).toBe(2)

    const result = await markDecisionReady(draft.decision.id, currentUser())
    expect(result).toEqual({ ok: false, error: 'contract_stale' })
  })

  it("planning_state_stale — le cycle cible a été republié entre la création du draft et la mise en prêt", async () => {
    const proposal = await generateSingleProposal(stateDriftEngagementId)
    const draft = await createDraftDecision(
      { proposalId: proposal.id, decisionPayload: modifyCyclePayload(missionStateDriftId, cycleForStateDriftId, proposal.proposalPayload) },
      currentUser(),
    )
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    expect(typeof draft.decision.planningStateFingerprint).toBe('string')

    await savePublishedCycleAtomic({
      cycleId: cycleForStateDriftId,
      payload: {
        siteId,
        missionId: missionStateDriftId,
        organizationId: memberOrgId,
        name: `${TAG} cycle state drift réécrit`,
        cycleLengthWeeks: 1,
        anchorDate: '2026-01-05',
        startsOn: '2026-01-05',
        endsOn: null,
        slots: [{ weekIndex: 0, weekday: 3, teamId, state: 'work', startTime: '10:00', endTime: '14:00' }],
        userId: null,
        status: 'published',
      },
      confirmReplaceSimple: true,
      actorId: null,
    })

    const result = await markDecisionReady(draft.decision.id, currentUser())
    expect(result).toEqual({ ok: false, error: 'planning_state_stale' })
  })

  it('target_not_found — le rythme SIMPLE cible a été supprimé entre la création du draft et la mise en prêt', async () => {
    const db = createAdminClient()
    const proposal = (await listPlanningImpactProposalsForEngagementSuspend()).find((p) => p.proposalPayload.operation === 'suspend')!
    const droppedTemplate = await createTemplate({
      mission_id: missionSuspendSimpleId,
      title: `${TAG} simple à supprimer`,
      frequency: 'weekly',
      day_of_week: 2,
      starts_on: '2026-01-01',
    })
    const draft = await createDraftDecision(
      { proposalId: proposal.id, decisionPayload: suspendPayload(missionSuspendSimpleId, 'simple', droppedTemplate.id, null, proposal.proposalPayload) },
      currentUser(),
    )
    expect(draft.ok).toBe(true)
    if (!draft.ok) return

    // Soft-delete, pas un DELETE physique : target_template_id est ON DELETE
    // CASCADE (migration 449) — un vrai DELETE emporterait la décision
    // elle-même et loadDecisionWithAccess renverrait access_denied (ligne
    // introuvable) avant même d'atteindre le chemin target_not_found visé ici.
    await db.from('intervention_templates').update({ deleted_at: new Date().toISOString() }).eq('id', droppedTemplate.id)

    const result = await markDecisionReady(draft.decision.id, currentUser())
    expect(result).toEqual({ ok: false, error: 'target_not_found' })
  })

  it('décision inexistante : refusé', async () => {
    const result = await markDecisionReady(randomUUID(), currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })
})

describe('cancelDecision', () => {
  it('ok — annule un draft, horodate et attribue à l’utilisateur, idempotent au second appel', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const draft = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload, 7) }, currentUser())
    expect(draft.ok).toBe(true)
    if (!draft.ok) return

    const first = await cancelDecision(draft.decision.id, currentUser(), 'changement de priorité')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.decision.status).toBe('cancelled')
    expect(first.decision.cancelledBy).toBe(adminUserId)
    expect(first.decision.cancellationReason).toBe('changement de priorité')

    const second = await cancelDecision(draft.decision.id, currentUser(), 'raison ignorée')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.decision.cancelledAt).toBe(first.decision.cancelledAt)
    expect(second.decision.cancellationReason).toBe(first.decision.cancellationReason)
  })

  it('ok — annule une décision ready', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const draft = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload, 8) }, currentUser())
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    const ready = await markDecisionReady(draft.decision.id, currentUser())
    expect(ready.ok).toBe(true)

    const result = await cancelDecision(draft.decision.id, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.decision.status).toBe('cancelled')
  })

  it('décision inexistante : refusé', async () => {
    const result = await cancelDecision(randomUUID(), currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  // already_applied : lu intégralement dans le corps de cancelDecision (mandat
  // §15) — la seule voie vers status='applied' est C2+ Apply, jamais implémentée
  // ici, et la contrainte DB planning_impact_application_decisions_c1_never_applied_check
  // (migration 449) interdit qu'une ligne atteigne jamais 'applied' en C1. Fabriquer
  // artificiellement ce statut via un UPDATE direct contournerait la garantie
  // même que ce lot doit prouver — jamais fait.
  it.skip("already_applied — structurellement inatteignable en C1, garanti par la contrainte DB c1_never_applied_check (mandat §15)", () => {})
})

describe('listDecisionsForProposal', () => {
  it('rend toutes les décisions de la proposition, triées de la plus récente à la plus ancienne', async () => {
    const proposal = await generateSingleProposal(newEngagementId)
    const first = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload, 9) }, currentUser())
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = await createDraftDecision({ proposalId: proposal.id, decisionPayload: newPayload(missionNewId, proposal.proposalPayload, 10) }, currentUser())
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const result = await listDecisionsForProposal(proposal.id, currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.decisions[0].id).toBe(second.decision.id)
    expect(result.decisions.some((d) => d.id === first.decision.id)).toBe(true)
  })

  it('proposition inexistante : refusé', async () => {
    const result = await listDecisionsForProposal(randomUUID(), currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('aucun oracle : proposition inexistante et proposition cross-org rendent le même message externe', async () => {
    const nonexistent = await listDecisionsForProposal(randomUUID(), currentUser())
    const unauthorizedUser = await listDecisionsForProposal((await generateSingleProposal(newEngagementId)).id, { id: randomUUID() })
    expect(nonexistent).toEqual(unauthorizedUser)
  })
})
