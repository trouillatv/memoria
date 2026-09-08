import { describe, expect, it } from 'vitest'
import { computeQuestionPriority, MEMORIA_NEEDS_YOU_PRIORITY_ORDER } from '@/lib/knowledge/tracked-point-needs-you-priority'
import type { MemoriaNeedsYouQuestion } from '@/lib/knowledge/tracked-point-needs-you-summary'
import type { ConsolidationQueuePointSide } from '@/lib/knowledge/tracked-point-consolidation-queue'
import type { TraceIdentityTarget } from '@/lib/knowledge/tracked-point-trace-queue'
import type {
  PendingResolutionKnownTarget,
  PendingResolutionSubjectSuggestion,
  PendingResolutionTargetingMode,
} from '@/lib/knowledge/tracked-point-pending-resolution-queue'

function pointSide(derivedState: string | null, overrides: Partial<ConsolidationQueuePointSide> = {}): ConsolidationQueuePointSide {
  return {
    id: 'point-1',
    label: 'Point',
    status: 'active',
    identityStatus: 'CONFIRMED',
    derivedState: derivedState as ConsolidationQueuePointSide['derivedState'],
    subjectId: null,
    subjectLabel: null,
    firstAppearanceAt: null,
    lastAppearanceAt: null,
    cboCount: 0,
    hardMemberCount: 0,
    ...overrides,
  } as ConsolidationQueuePointSide
}

function duplicatePointsQuestion(
  derivedStateA: string | null,
  derivedStateB: string | null,
  componentSize = 2,
): MemoriaNeedsYouQuestion {
  return {
    category: 'duplicate_points',
    id: 'pair-1',
    entry: {
      pairId: 'pair-1',
      siteId: 'site-1',
      pointA: pointSide(derivedStateA),
      pointB: pointSide(derivedStateB),
      candidateIds: [],
      reciprocal: false,
      componentId: 'component-1',
      componentSize,
    },
  } as MemoriaNeedsYouQuestion
}

function traceTarget(derivedState: string | null): TraceIdentityTarget {
  return {
    candidateId: 'candidate-1',
    pointId: 'point-1',
    canonicalPointId: null,
    scope: 'thread',
    label: null,
    identityStatus: null,
    derivedState: derivedState as TraceIdentityTarget['derivedState'],
    subject: null,
    subjectLabel: null,
    latestMeaningfulEventAt: null,
    cboCount: 0,
    hardMemberCount: 0,
    actionability: 'ACTIONABLE',
    blockerReason: null,
    classification: {
      category: 'SAFE_SINGLE_TRACE_THREAD',
      canonicalTargetId: null,
      sourceOwnPointId: null,
      relation: null,
      attachedAt: null,
      blockerReason: null,
    },
  } as TraceIdentityTarget
}

function attachInformationQuestion(targets: TraceIdentityTarget[]): MemoriaNeedsYouQuestion {
  return {
    category: 'attach_information',
    id: 'source-1',
    entry: {
      sourceKey: 'source-1',
      targets,
      targetCount: targets.length,
    },
  } as MemoriaNeedsYouQuestion
}

function resolutionTarget(derivedState: string | null): PendingResolutionKnownTarget {
  return {
    pointId: 'point-1',
    label: null,
    identityStatus: null,
    derivedState: derivedState as PendingResolutionKnownTarget['derivedState'],
    subjectId: null,
    subjectLabel: null,
    latestMeaningfulEventAt: null,
    candidateId: 'candidate-1',
  }
}

function resolutionSuggestion(derivedState: string | null): PendingResolutionSubjectSuggestion {
  return {
    pointId: 'point-2',
    label: null,
    identityStatus: null,
    derivedState: derivedState as PendingResolutionSubjectSuggestion['derivedState'],
    subjectId: null,
    subjectLabel: null,
    latestMeaningfulEventAt: null,
  }
}

function assignResolutionQuestion(
  knownIdentityTargets: PendingResolutionKnownTarget[],
  sameSubjectSuggestions: PendingResolutionSubjectSuggestion[],
  targetingMode: PendingResolutionTargetingMode,
): MemoriaNeedsYouQuestion {
  return {
    category: 'assign_resolution',
    id: 'pending-1',
    entry: {
      pendingTraceId: 'pending-1',
      sourceThreadId: 'thread-1',
      evidenceStatus: 'RESOLVED',
      evidenceBasis: null,
      evidenceProposalIds: [],
      sourceLabel: null,
      sourceDate: null,
      sourceDocumentId: null,
      sourceDocumentFilename: null,
      sourceDocumentEffectiveDate: null,
      sourcePage: null,
      knownIdentityTargets,
      sameSubjectSuggestions,
      targetingMode,
      actionable: true,
    },
  } as MemoriaNeedsYouQuestion
}

function confirmTrackabilityQuestion(): MemoriaNeedsYouQuestion {
  return {
    category: 'confirm_trackability',
    id: 'pending-2',
    entry: {} as never,
  } as MemoriaNeedsYouQuestion
}

function clarifyEvidenceQuestion(): MemoriaNeedsYouQuestion {
  return {
    category: 'clarify_evidence',
    id: 'pending-3',
    entry: {} as never,
  } as MemoriaNeedsYouQuestion
}

describe('computeQuestionPriority', () => {
  it('reopened Point -> PRIORITAIRE', () => {
    expect(computeQuestionPriority(duplicatePointsQuestion('reopened', 'open'))).toBe('PRIORITAIRE')
  })

  it('conflict Point -> PRIORITAIRE', () => {
    expect(computeQuestionPriority(attachInformationQuestion([traceTarget('conflict')]))).toBe('PRIORITAIRE')
  })

  it('open Point directly touched -> IMPORTANT', () => {
    expect(computeQuestionPriority(duplicatePointsQuestion('open', 'resolved'))).toBe('IMPORTANT')
  })

  it('unknown Point -> A_CLARIFIER', () => {
    expect(computeQuestionPriority(attachInformationQuestion([traceTarget('unknown')]))).toBe('A_CLARIFIER')
  })

  it('structurally ambiguous without active/open/unknown Point -> A_CLARIFIER', () => {
    expect(computeQuestionPriority(duplicatePointsQuestion('resolved', 'resolved', 3))).toBe('A_CLARIFIER')
  })

  it('open Point AND structurally ambiguous -> IMPORTANT (impact métier prime sur l ambiguïté)', () => {
    expect(computeQuestionPriority(duplicatePointsQuestion('open', 'resolved', 3))).toBe('IMPORTANT')
  })

  it('assign_resolution with open sameSubjectSuggestion -> IMPORTANT', () => {
    const question = assignResolutionQuestion([], [resolutionSuggestion('open')], 'SUBJECT_SINGLE')
    expect(computeQuestionPriority(question)).toBe('IMPORTANT')
  })

  it('assign_resolution with reopened knownIdentityTarget -> PRIORITAIRE even if also ambiguous', () => {
    const question = assignResolutionQuestion([resolutionTarget('reopened')], [], 'KNOWN_MULTI')
    expect(computeQuestionPriority(question)).toBe('PRIORITAIRE')
  })

  it('assign_resolution SEARCH_REQUIRED with no active/open/unknown target -> A_CLARIFIER', () => {
    const question = assignResolutionQuestion([], [], 'SEARCH_REQUIRED')
    expect(computeQuestionPriority(question)).toBe('A_CLARIFIER')
  })

  it('no active/open/unknown signal and not ambiguous -> HISTORIQUE', () => {
    expect(computeQuestionPriority(duplicatePointsQuestion('resolved', 'resolved', 2))).toBe('HISTORIQUE')
  })

  it('confirm_trackability never touches a Point -> HISTORIQUE', () => {
    expect(computeQuestionPriority(confirmTrackabilityQuestion())).toBe('HISTORIQUE')
  })

  it('clarify_evidence never touches a Point -> HISTORIQUE', () => {
    expect(computeQuestionPriority(clarifyEvidenceQuestion())).toBe('HISTORIQUE')
  })

  it('precedence order is PRIORITAIRE > IMPORTANT > A_CLARIFIER > HISTORIQUE', () => {
    expect(MEMORIA_NEEDS_YOU_PRIORITY_ORDER).toEqual(['PRIORITAIRE', 'IMPORTANT', 'A_CLARIFIER', 'HISTORIQUE'])
  })
})
