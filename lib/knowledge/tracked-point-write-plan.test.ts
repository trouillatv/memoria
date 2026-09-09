import { describe, expect, it } from 'vitest'
import type { FoundingOutcomeV2, FoundingUnit, PropRow } from './tracked-point-founding'
import {
  classifyRootCause,
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
