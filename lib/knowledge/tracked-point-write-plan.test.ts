import { describe, expect, it } from 'vitest'
import type { FoundingOutcomeV2, FoundingUnit, PropRow } from './tracked-point-founding'
import type { TrackedPointCandidate } from './tracked-point-membership-candidates'
import {
  classifyRootCause,
  crossThreadConcurrentPointIds,
  foundingReferenceOf,
  memberOf,
  planPendingTraceForUnit,
  planPointForUnit,
  upstreamDefectOf,
} from './tracked-point-write-plan'

function prop(overrides: Partial<PropRow> & { proposal_family: string }): PropRow {
  return {
    id: overrides.id ?? `prop-${Math.random().toString(36).slice(2)}`,
    proposal_family: overrides.proposal_family,
    document_status: overrides.document_status ?? null,
    label: overrides.label ?? 'label',
    subject_thread_id: overrides.subject_thread_id ?? 'thread-1',
    document_id: overrides.document_id ?? null,
    extraction_run_id: overrides.extraction_run_id ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    review_status: overrides.review_status ?? null,
    source_payload: overrides.source_payload ?? null,
  }
}

function unit(overrides: Partial<FoundingUnit> & { outcomeV2: FoundingOutcomeV2 }): FoundingUnit {
  return {
    threadId: overrides.threadId ?? 'thread-1',
    scope: overrides.scope ?? 'thread',
    proposalSetOf: overrides.proposalSetOf,
    props: overrides.props ?? [],
    families: overrides.families ?? [],
    threadLabel: overrides.threadLabel ?? 'Sujet 1',
    outcomeOld: overrides.outcomeOld ?? 'UNCOVERED_FAMILY_COMBINATION',
    outcomeV2: overrides.outcomeV2,
    trackability: overrides.trackability,
  }
}

describe('classifyRootCause', () => {
  it('SHOULD_HAVE_CBO_BUT_MISSING quand la proposition est déjà matérialisée', () => {
    expect(classifyRootCause({ review_status: 'materialized', source_payload: null })).toBe('SHOULD_HAVE_CBO_BUT_MISSING')
  })

  it('NON_OPERATIONAL_CONTEXT quand la pertinence est weak', () => {
    expect(classifyRootCause({ review_status: null, source_payload: { relevanceScore: 'weak' } })).toBe('NON_OPERATIONAL_CONTEXT')
  })

  it('DOCUMENTARY_ACTION_NOT_PROMOTED quand la pertinence est strong ou medium', () => {
    expect(classifyRootCause({ review_status: null, source_payload: { relevanceScore: 'strong' } })).toBe('DOCUMENTARY_ACTION_NOT_PROMOTED')
    expect(classifyRootCause({ review_status: null, source_payload: { relevanceScore: 'medium' } })).toBe('DOCUMENTARY_ACTION_NOT_PROMOTED')
  })

  it('UNKNOWN hors de ces cas', () => {
    expect(classifyRootCause({ review_status: null, source_payload: null })).toBe('UNKNOWN')
  })
})

describe('upstreamDefectOf', () => {
  it('flag=true avec la cause de la première action/deadline en défaut', () => {
    const u = unit({
      props: [prop({ proposal_family: 'action', review_status: 'materialized' })],
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    expect(upstreamDefectOf(u)).toEqual({ flag: true, cause: 'SHOULD_HAVE_CBO_BUT_MISSING' })
  })

  it('flag=true sur deadline avec pertinence strong (DOCUMENTARY_ACTION_NOT_PROMOTED)', () => {
    const u = unit({
      props: [prop({ proposal_family: 'deadline', source_payload: { relevanceScore: 'strong' } })],
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    expect(upstreamDefectOf(u)).toEqual({ flag: true, cause: 'DOCUMENTARY_ACTION_NOT_PROMOTED' })
  })

  it('flag=false quand aucune action/deadline n\'est présente', () => {
    const u = unit({
      props: [prop({ proposal_family: 'decision' })],
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    expect(upstreamDefectOf(u)).toEqual({ flag: false, cause: null })
  })

  it('flag=false quand les actions/deadlines présentes ne sont que UNKNOWN', () => {
    const u = unit({
      props: [prop({ proposal_family: 'action', review_status: null, source_payload: null })],
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    expect(upstreamDefectOf(u)).toEqual({ flag: false, cause: null })
  })
})

describe('memberOf', () => {
  it('scope=thread → proposal_ids null', () => {
    const u = unit({ threadId: 't1', scope: 'thread', outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-1' } })
    expect(memberOf(u)).toEqual({
      subject_thread_id: 't1',
      scope: 'thread',
      proposal_ids: null,
      evidence_grade: 'HARD',
      resolution_source: 'deterministic',
    })
  })

  it('scope=proposal_set → proposal_ids = ids des props du unit', () => {
    const p1 = prop({ id: 'p1', proposal_family: 'decision' })
    const p2 = prop({ id: 'p2', proposal_family: 'reservation' })
    const u = unit({ threadId: 't1', scope: 'proposal_set', proposalSetOf: 'cbo:cbo-a', props: [p1, p2], outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-a' } })
    expect(memberOf(u).proposal_ids).toEqual(['p1', 'p2'])
  })
})

describe('foundingReferenceOf', () => {
  it('scope=thread → threadId seul', () => {
    expect(foundingReferenceOf(unit({ threadId: 't1', scope: 'thread', outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } }))).toBe('t1')
  })

  it('scope=proposal_set → threadId#proposalSetOf', () => {
    expect(
      foundingReferenceOf(unit({ threadId: 't1', scope: 'proposal_set', proposalSetOf: 'cbo:cbo-a', outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-a' } })),
    ).toBe('t1#cbo:cbo-a')
  })
})

describe('planPointForUnit', () => {
  it('CONFIRMED → founding_kind=cbo, identity_status=CONFIRMED, founding_reference=cboId', () => {
    const u = unit({ threadId: 't1', scope: 'thread', outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-1' } })
    const plan = planPointForUnit(u, { cboLabel: 'Sprinkler zone A', canonicalSubjectId: 'cs-1', canonicalSubjectLabel: 'Sprinkler' })
    expect(plan).toMatchObject({
      label: 'Sprinkler zone A',
      founding_kind: 'cbo',
      identity_status: 'CONFIRMED',
      founding_source: 'canonical_business_object',
      founding_reference: 'cbo-1',
      has_upstream_defect: false,
      seed_source: 'cbo_seed',
      canonical_subject_id: 'cs-1',
      canonical_subject_label: 'Sprinkler',
    })
    expect(plan!.member.hardBasis).toBe('CBO_FOUNDER')
  })

  it('CONFIRMED sans ctx.cboLabel → libellé de repli', () => {
    const u = unit({ threadId: 't1', scope: 'thread', outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-1' } })
    expect(planPointForUnit(u)!.label).toBe('(CBO sans libellé)')
  })

  it('PROVISIONAL → founding_kind=trackable_condition, founding_source=triggerFamily', () => {
    const u = unit({
      threadId: 't1',
      scope: 'thread',
      threadLabel: 'Sujet observation',
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    const plan = planPointForUnit(u)
    expect(plan).toMatchObject({
      label: 'Sujet observation',
      founding_kind: 'trackable_condition',
      identity_status: 'PROVISIONAL',
      founding_source: 'decision',
      founding_reference: 't1',
      seed_source: 'thread_seed',
    })
    expect(plan!.member.hardBasis).toBe('TRACKABLE_FOUNDER')
  })

  it('PROVISIONAL avec action en défaut → has_upstream_defect=true', () => {
    const u = unit({
      threadId: 't1',
      scope: 'thread',
      props: [prop({ proposal_family: 'action', review_status: 'materialized' })],
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    expect(planPointForUnit(u)!.has_upstream_defect).toBe(true)
  })

  it('PROVISIONAL_TRACKABLE avec cause de défaut identifiée → founding_source=cause en minuscules', () => {
    const u = unit({
      threadId: 't1',
      scope: 'thread',
      props: [prop({ proposal_family: 'action', source_payload: { relevanceScore: 'strong' } })],
      outcomeV2: { kind: 'PROVISIONAL_TRACKABLE', trackability: 'TRACKABLE_CONDITION' },
    })
    const plan = planPointForUnit(u)
    expect(plan).toMatchObject({
      founding_kind: 'trackable_condition',
      identity_status: 'PROVISIONAL',
      founding_source: 'documentary_action_not_promoted',
      has_upstream_defect: true,
    })
  })

  it('PROVISIONAL_TRACKABLE sans cause de défaut → founding_source=trackability_v2', () => {
    const u = unit({
      threadId: 't1',
      scope: 'thread',
      props: [prop({ proposal_family: 'planning' })],
      outcomeV2: { kind: 'PROVISIONAL_TRACKABLE', trackability: 'TRACKABLE_CONDITION' },
    })
    const plan = planPointForUnit(u)
    expect(plan!.founding_source).toBe('trackability_v2')
    expect(plan!.has_upstream_defect).toBe(false)
  })

  it.each<FoundingOutcomeV2>([
    { kind: 'NO_POINT_EMPTY_THREAD' },
    { kind: 'NO_POINT_KNOWLEDGE_ONLY' },
    { kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM' },
    { kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM_TRACKABILITY' },
    { kind: 'EXCLUDED_ACTOR_CONTEXT_TEMPORAL', trackability: 'ACTOR_ONLY' },
    { kind: 'PENDING_TRACKABILITY' },
  ])('retourne null pour %o', (outcomeV2) => {
    expect(planPointForUnit(unit({ outcomeV2 }))).toBeNull()
  })
})

function sitePoint(overrides: Partial<TrackedPointCandidate> & { pointId: string }): TrackedPointCandidate {
  return {
    pointId: overrides.pointId,
    label: overrides.label ?? 'label',
    ownerSubjectId: overrides.ownerSubjectId ?? 'subject-a',
    ownerSubjectLabel: overrides.ownerSubjectLabel ?? 'Sujet A',
    memberLabels: overrides.memberLabels ?? [],
    memberCboIds: overrides.memberCboIds ?? [],
    memberRunIds: overrides.memberRunIds ?? [],
  }
}

// Rejoue au niveau write-plan (le chemin réel emprunté par reconcileTrackedPointUnit →
// crossThreadConcurrentPointIds → p_cross_thread_candidate_point_ids) les témoins imposés par
// le mandat « raccordement du rail V2 » : R7, zone après la dalle, CTA (anti-overmerge) et le
// chemin UNCERTAIN → NeedsYou. Données réelles portées depuis le pilote OCEF (CR011/CR012).
describe('crossThreadConcurrentPointIds — rail V2 au niveau write-plan (production)', () => {
  it('R7 : le Point CR011 entre dans les candidats du write-plan (UNCERTAIN sans juge, jamais exclu)', async () => {
    const r7Point = sitePoint({
      pointId: 'a3713857-3fbd-4ca7-88f5-7dada975ddf0',
      label: 'Surveillance des fissures du Regard R7 jusqu\'au prochain CR, sans réparation immédiate',
      ownerSubjectId: '79e0509e',
      ownerSubjectLabel: 'Assainissement sous plateforme (busages, regards, visite mairie)',
      memberLabels: ['Fissures Regard R7 mesurées < 0,2 mm et limitées à la peau du béton'],
    })
    const cr012Unit = unit({
      threadId: '7218166a-ed65-4db8-b319-61e918702480',
      threadLabel: "OMNIS confirme l'absence de réparation nécessaire pour le Regard R7",
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    const ids = await crossThreadConcurrentPointIds(cr012Unit, [r7Point], {
      canonicalSubjectId: 'b1524a67',
      canonicalSubjectLabel: 'Surveillance des fissures du Regard R7',
    })
    expect(ids).toContain(r7Point.pointId)
  })

  it('R7 : juge SAME_POINT explicite → le Point CR011 reste dans les candidats (fusion assumée, pas silencieuse)', async () => {
    const r7Point = sitePoint({
      pointId: 'a3713857-3fbd-4ca7-88f5-7dada975ddf0',
      label: 'Surveillance des fissures du Regard R7 jusqu\'au prochain CR, sans réparation immédiate',
      ownerSubjectId: '79e0509e',
      ownerSubjectLabel: 'Assainissement sous plateforme (busages, regards, visite mairie)',
      memberLabels: ['Fissures Regard R7 mesurées < 0,2 mm et limitées à la peau du béton'],
    })
    const cr012Unit = unit({
      threadId: '7218166a-ed65-4db8-b319-61e918702480',
      threadLabel: "OMNIS confirme l'absence de réparation nécessaire pour le Regard R7",
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    const ids = await crossThreadConcurrentPointIds(
      cr012Unit,
      [r7Point],
      { canonicalSubjectId: 'b1524a67', canonicalSubjectLabel: 'Surveillance des fissures du Regard R7' },
      { identityJudge: async () => ({ decision: 'SAME_POINT', reasoning: 'même condition, même preuve de clôture' }) },
    )
    expect(ids).toContain(r7Point.pointId)
  })

  it('zone après la dalle : ne tombe pas directement en DISTINCT silencieux, le Point reste candidat', async () => {
    const dallePoint = sitePoint({
      pointId: '3e69ce84-e8ec-455d-9ee1-e5cb63adfbef',
      label: 'Mise en demeure maintenue jusqu\'à contre-essais conformes pour la zone après la dalle',
      ownerSubjectId: 'dc567108',
      ownerSubjectLabel: 'Non-conformité zone après la dalle',
      memberLabels: ['Essais PANDA non conformes'],
    })
    const moeUnit = unit({
      threadId: '8a1e0e23-eb7e-45b6-9fcf-c2a7ddba6906',
      threadLabel: 'Le MOE lève la réserve technique sur la zone après la dalle',
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    const ids = await crossThreadConcurrentPointIds(moeUnit, [dallePoint], {
      canonicalSubjectId: 'dc567108',
      canonicalSubjectLabel: 'Non-conformité zone après la dalle',
    })
    expect(ids).toContain(dallePoint.pointId)
  })

  it('étalon CTA : ancrage générique commun ne provoque pas de fusion abusive, le Point est exclu (DISTINCT_POINT)', async () => {
    const ctaPoint = sitePoint({
      pointId: 'point-cta-programmation',
      label: "Vérifier la programmation d'arrêt des CTA",
      ownerSubjectId: 'subj-cta-programmation',
      ownerSubjectLabel: "Programmation d'arrêt des CTA",
    })
    const raccordementUnit = unit({
      threadId: 'kf-cta-raccordement',
      threadLabel: 'Raccordement de la CTA au SSI',
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    const ids = await crossThreadConcurrentPointIds(raccordementUnit, [ctaPoint], {
      canonicalSubjectId: 'subj-cta-raccordement',
      canonicalSubjectLabel: 'Raccordement CTA SSI',
    })
    expect(ids).not.toContain(ctaPoint.pointId)
    expect(ids).toEqual([])
  })

  it('UNCERTAIN → NeedsYou : juge qui décline (null) laisse le Point candidat, jamais un défaut SAME/DISTINCT silencieux', async () => {
    const p = sitePoint({ pointId: 'point-r7-ambigu', label: 'Surveillance des fissures du Regard R7', ownerSubjectId: 's1' })
    const c = unit({
      threadId: 'thread-r7-ambigu',
      threadLabel: "Le Regard R7 fait l'objet d'un suivi renforcé",
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    const ids = await crossThreadConcurrentPointIds(c, [p], { canonicalSubjectId: 's2', canonicalSubjectLabel: 'Sujet S2' }, {
      identityJudge: async () => null,
    })
    expect(ids).toContain(p.pointId)
  })

  it('exact/CBO forts continuent de fonctionner sans régression (containment strict → SAME_POINT via moteur étroit)', async () => {
    const p = sitePoint({ pointId: 'point-exact', label: 'Vérifier la programmation d\'arrêt des CTA', ownerSubjectId: 'subj-a', ownerSubjectLabel: 'Sujet A' })
    const c = unit({
      threadId: 'thread-exact',
      threadLabel: 'Vérifier la programmation d\'arrêt des CTA',
      outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    })
    const ids = await crossThreadConcurrentPointIds(c, [p], { canonicalSubjectId: 'subj-a', canonicalSubjectLabel: 'Sujet A' })
    expect(ids).toContain(p.pointId)
  })
})

describe('planPendingTraceForUnit', () => {
  it('PENDING_TRACKABILITY → kind=TRACKABILITY_UNDETERMINED', () => {
    const u = unit({ threadId: 't1', scope: 'thread', outcomeV2: { kind: 'PENDING_TRACKABILITY' } })
    const trace = planPendingTraceForUnit(u)
    expect(trace).toMatchObject({ source_thread_id: 't1', source_proposal_id: null, kind: 'TRACKABILITY_UNDETERMINED' })
  })

  it('RESOLUTION_WITHOUT_KNOWN_PROBLEM → kind=RESOLUTION_WITHOUT_KNOWN_PROBLEM', () => {
    const u = unit({ threadId: 't1', scope: 'thread', outcomeV2: { kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM' } })
    expect(planPendingTraceForUnit(u)).toMatchObject({ source_thread_id: 't1', kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM' })
  })

  it('RESOLUTION_WITHOUT_KNOWN_PROBLEM_TRACKABILITY → kind=RESOLUTION_WITHOUT_KNOWN_PROBLEM', () => {
    const u = unit({ threadId: 't1', scope: 'thread', outcomeV2: { kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM_TRACKABILITY' } })
    expect(planPendingTraceForUnit(u)).toMatchObject({ source_thread_id: 't1', kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM' })
  })

  it.each<FoundingOutcomeV2>([
    { kind: 'CONFIRMED', cboId: 'cbo-1' },
    { kind: 'PROVISIONAL', triggerFamily: 'decision' },
    { kind: 'PROVISIONAL_TRACKABLE', trackability: 'TRACKABLE_CONDITION' },
    { kind: 'NO_POINT_EMPTY_THREAD' },
    { kind: 'NO_POINT_KNOWLEDGE_ONLY' },
    { kind: 'EXCLUDED_ACTOR_CONTEXT_TEMPORAL', trackability: 'ACTOR_ONLY' },
  ])('retourne null pour %o', (outcomeV2) => {
    expect(planPendingTraceForUnit(unit({ outcomeV2 }))).toBeNull()
  })
})
