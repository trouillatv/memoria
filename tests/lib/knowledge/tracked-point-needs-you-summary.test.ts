// Phase 6E.4A — test UNITAIRE (pur, zéro DB) de buildMemoriaNeedsYouSummary.
//
// Couvre la seule règle métier de cet agrégateur : une pending trace non actionnable par
// evidence unresolved (trackability/resolution) ne produit JAMAIS de question dans sa catégorie
// native — elle n'existe, pour l'humain, que sous 'clarify_evidence' (jamais comptée deux fois,
// jamais perdue).

import { describe, it, expect } from 'vitest'
import {
  buildMemoriaNeedsYouSummary,
  filterMemoriaNeedsYouQuestionsForPoint,
  filterMemoriaNeedsYouQuestionsForSubject,
  resolveMemoriaNeedsYouSubjectPointRef,
  needsYouQuestionHref,
  MEMORIA_NEEDS_YOU_CATEGORY_ORDER,
  type MemoriaNeedsYouQuestion,
} from '@/lib/knowledge/tracked-point-needs-you-summary'
import type { ConsolidationQueue, ConsolidationQueueEntry, ConsolidationQueuePointSide } from '@/lib/knowledge/tracked-point-consolidation-queue'
import type { TraceIdentityQueue, TraceIdentitySourceEntry, TraceIdentityTarget } from '@/lib/knowledge/tracked-point-trace-queue'
import type { PendingTrackabilityQueue, PendingTrackabilityQueueEntry } from '@/lib/knowledge/tracked-point-pending-trackability-queue'
import type {
  PendingResolutionQueue,
  PendingResolutionQueueEntry,
  PendingResolutionKnownTarget,
  PendingResolutionSubjectSuggestion,
} from '@/lib/knowledge/tracked-point-pending-resolution-queue'
import type { EvidenceScopeQueue, EvidenceScopeQueueEntry } from '@/lib/knowledge/tracked-point-evidence-scope-queue'

const SITE_ID = 'site-1'

function pointSide(id: string): ConsolidationQueuePointSide {
  return {
    id,
    label: `point ${id}`,
    status: 'active',
    identityStatus: 'PROVISIONAL',
    derivedState: null,
    subjectId: null,
    subjectLabel: null,
    firstAppearanceAt: null,
    lastAppearanceAt: null,
    cboCount: 0,
    hardMemberCount: 0,
    proofs: [],
    proofCount: 0,
  }
}

function consolidationQueue(entries: ConsolidationQueueEntry[]): ConsolidationQueue {
  return { siteId: SITE_ID, entries, totalPairs: entries.length, complexComponentCount: 0 }
}

function consolidationEntry(pairId: string): ConsolidationQueueEntry {
  return {
    pairId,
    siteId: SITE_ID,
    pointA: pointSide('a'),
    pointB: pointSide('b'),
    candidateIds: ['cand-1'],
    reciprocal: false,
    componentId: 'a',
    componentSize: 2,
    predictedTargetPointId: null,
    predictedSourcePointId: null,
  }
}

function traceIdentityQueue(entries: TraceIdentitySourceEntry[]): TraceIdentityQueue {
  return { siteId: SITE_ID, entries, totalSources: entries.length, totalTargets: entries.reduce((s, e) => s + e.targetCount, 0) }
}

function traceIdentityEntry(sourceKey: string): TraceIdentitySourceEntry {
  return {
    sourceKey,
    sourceThreadId: sourceKey,
    sourceProposalIds: ['prop-1'],
    scope: 'thread',
    sourceLabel: null,
    sourceDocumentId: null,
    sourceDocumentFilename: null,
    sourceDocumentType: null,
    sourceDocumentEffectiveDate: null,
    sourcePage: null,
    sourceExcerpt: null,
    hasVerbatimExcerpt: false,
    sourceDate: null,
    targets: [],
    targetCount: 1,
    evidenceScopeStatus: 'ACTIONABLE',
    pendingTraceId: null,
    needsFreeIdentityResolution: false,
  }
}

function trackabilityQueue(entries: PendingTrackabilityQueueEntry[]): PendingTrackabilityQueue {
  return { siteId: SITE_ID, entries, totalEntries: entries.length, excludedAlreadyTracked: [] }
}

function trackabilityEntry(
  pendingTraceId: string,
  actionable: boolean,
  overrides: Partial<PendingTrackabilityQueueEntry> = {},
): PendingTrackabilityQueueEntry {
  return {
    pendingTraceId,
    sourceThreadId: pendingTraceId,
    siteId: SITE_ID,
    subjectId: null,
    subjectLabel: null,
    reason: null,
    createdAt: null,
    evidenceStatus: actionable ? 'resolved' : 'unresolved',
    evidenceProposalIds: actionable ? ['prop-1'] : [],
    sourceLabel: null,
    sourceDocumentEffectiveDate: null,
    sourcePage: null,
    sourceDate: null,
    sourceDocumentId: null,
    sourceDocumentFilename: null,
    sourceDocumentType: null,
    sourceExcerpt: null,
    hasVerbatimExcerpt: false,
    actionable,
    ...overrides,
  }
}

function resolutionQueue(entries: PendingResolutionQueueEntry[]): PendingResolutionQueue {
  return { siteId: SITE_ID, entries, totalEntries: entries.length, excludedAlreadyConsumed: [] }
}

function resolutionEntry(
  pendingTraceId: string,
  actionable: boolean,
  overrides: Partial<PendingResolutionQueueEntry> = {},
): PendingResolutionQueueEntry {
  return {
    pendingTraceId,
    sourceThreadId: pendingTraceId,
    evidenceStatus: actionable ? 'resolved' : 'unresolved',
    evidenceBasis: actionable ? 'human_selected' : null,
    evidenceProposalIds: actionable ? ['prop-1'] : [],
    sourceLabel: null,
    sourceDocumentEffectiveDate: null,
    sourcePage: null,
    sourceDate: null,
    sourceDocumentId: null,
    sourceDocumentFilename: null,
    sourceDocumentType: null,
    sourceExcerpt: null,
    hasVerbatimExcerpt: false,
    knownIdentityTargets: [],
    sameSubjectSuggestions: [],
    targetingMode: actionable ? 'SEARCH_REQUIRED' : 'EVIDENCE_SCOPE_UNRESOLVED',
    actionable,
    ...overrides,
  }
}

function evidenceScopeQueue(entries: EvidenceScopeQueueEntry[]): EvidenceScopeQueue {
  return { siteId: SITE_ID, entries, totalEntries: entries.length }
}

function evidenceScopeEntry(pendingTraceId: string, kind: string): EvidenceScopeQueueEntry {
  return {
    pendingTraceId,
    kind,
    sourceThreadId: pendingTraceId,
    siteId: SITE_ID,
    subjectId: null,
    subjectLabel: null,
    reason: null,
    createdAt: null,
    proposals: [],
    proposalCount: 0,
  }
}

describe('buildMemoriaNeedsYouSummary', () => {
  it('compose une question par entrée actionnable, une par catégorie', () => {
    const summary = buildMemoriaNeedsYouSummary(
      SITE_ID,
      consolidationQueue([consolidationEntry('pair-1')]),
      traceIdentityQueue([traceIdentityEntry('source-1')]),
      trackabilityQueue([trackabilityEntry('trace-1', true)]),
      resolutionQueue([resolutionEntry('trace-2', true)]),
      evidenceScopeQueue([evidenceScopeEntry('trace-3', 'TRACKABILITY_UNDETERMINED')]),
    )

    expect(summary.totalCount).toBe(5)
    expect(summary.categories.map((c) => c.category)).toEqual(MEMORIA_NEEDS_YOU_CATEGORY_ORDER)
    expect(summary.categories.map((c) => c.count)).toEqual([1, 1, 1, 1, 1])
    expect(summary.questions.map((q) => q.category)).toEqual([
      'duplicate_points',
      'attach_information',
      'confirm_trackability',
      'assign_resolution',
      'clarify_evidence',
    ])
  })

  it("une pending trace non actionnable (evidence unresolved) n'apparaît que sous clarify_evidence, jamais dans sa catégorie native", () => {
    const summary = buildMemoriaNeedsYouSummary(
      SITE_ID,
      consolidationQueue([]),
      traceIdentityQueue([]),
      trackabilityQueue([trackabilityEntry('trace-1', false)]),
      resolutionQueue([resolutionEntry('trace-2', false)]),
      evidenceScopeQueue([
        evidenceScopeEntry('trace-1', 'TRACKABILITY_UNDETERMINED'),
        evidenceScopeEntry('trace-2', 'RESOLUTION_WITHOUT_KNOWN_PROBLEM'),
      ]),
    )

    expect(summary.totalCount).toBe(2)
    const byCategory = Object.fromEntries(summary.categories.map((c) => [c.category, c.count]))
    expect(byCategory.confirm_trackability).toBe(0)
    expect(byCategory.assign_resolution).toBe(0)
    expect(byCategory.clarify_evidence).toBe(2)
    expect(summary.questions.every((q) => q.category === 'clarify_evidence')).toBe(true)
  })

  it('file vide : totalCount=0, 5 catégories toutes à 0, ordre stable', () => {
    const summary = buildMemoriaNeedsYouSummary(
      SITE_ID,
      consolidationQueue([]),
      traceIdentityQueue([]),
      trackabilityQueue([]),
      resolutionQueue([]),
      evidenceScopeQueue([]),
    )

    expect(summary.totalCount).toBe(0)
    expect(summary.categories).toHaveLength(5)
    expect(summary.categories.every((c) => c.count === 0)).toBe(true)
    expect(summary.questions).toEqual([])
    expect(summary.latestPvDate).toBeNull()
    expect(summary.latestPvCount).toBe(0)
    expect(summary.historicalCount).toBe(0)
  })

  it('6E.4A.5 — latestPvDate/latestPvCount/historicalCount : split dernier PV vs historique, jamais un total brut', () => {
    const summary = buildMemoriaNeedsYouSummary(
      SITE_ID,
      consolidationQueue([consolidationEntry('pair-1')]), // sans date : compte dans historicalCount
      traceIdentityQueue([]),
      trackabilityQueue([trackabilityEntry('trace-1', true, { sourceDocumentEffectiveDate: '2026-03-01' })]),
      resolutionQueue([
        resolutionEntry('trace-2', true, { sourceDocumentEffectiveDate: '2026-03-01' }), // même jour, même dernier PV
        resolutionEntry('trace-3', true, { sourceDocumentEffectiveDate: '2026-02-01' }), // PV plus ancien
      ]),
      evidenceScopeQueue([]),
    )

    expect(summary.totalCount).toBe(4)
    expect(summary.latestPvDate).toBe('2026-03-01')
    expect(summary.latestPvCount).toBe(2) // trace-1 + trace-2, même date métier
    expect(summary.historicalCount).toBe(2) // pair-1 (sans date) + trace-3 (PV plus ancien)
  })
})

function traceTarget(pointId: string): TraceIdentityTarget {
  return {
    candidateId: `cand-${pointId}`,
    pointId,
    canonicalPointId: null,
    scope: 'thread',
    label: null,
    identityStatus: null,
    derivedState: null,
    subject: null,
    subjectLabel: null,
    latestMeaningfulEventAt: null,
    cboCount: 0,
    hardMemberCount: 0,
    actionability: 'ACTIONABLE',
    blockerReason: null,
    classification: { category: 'SAFE_SINGLE_TRACE_THREAD', canonicalTargetId: null, sourceOwnPointId: null, relation: null, attachedAt: null, blockerReason: null },
  }
}

function pointRef(pointId: string): PendingResolutionKnownTarget & PendingResolutionSubjectSuggestion {
  return {
    pointId,
    candidateId: `cand-${pointId}`,
    label: null,
    identityStatus: null,
    derivedState: null,
    subjectId: null,
    subjectLabel: null,
    latestMeaningfulEventAt: null,
  }
}

// Lot UX Point 3F (mandat Vincent) — filterMemoriaNeedsYouQuestionsForPoint : seules les
// catégories dont la donnée référence RÉELLEMENT le Point qualifient (vérifié champ par champ,
// zéro heuristique). confirm_trackability/clarify_evidence n'ont structurellement aucune
// référence pointId — toujours exclues, jamais un oubli.
describe('filterMemoriaNeedsYouQuestionsForPoint', () => {
  it('duplicate_points : matche pointA OU pointB, exclut les paires étrangères', () => {
    const entry = consolidationEntry('pair-1')
    const match: MemoriaNeedsYouQuestion = { category: 'duplicate_points', id: 'pair-1', entry }
    expect(filterMemoriaNeedsYouQuestionsForPoint([match], 'a')).toEqual([match])
    expect(filterMemoriaNeedsYouQuestionsForPoint([match], 'b')).toEqual([match])
    expect(filterMemoriaNeedsYouQuestionsForPoint([match], 'other')).toEqual([])
  })

  it('attach_information : matche si un des targets référence ce Point', () => {
    const entry = { ...traceIdentityEntry('source-1'), targets: [traceTarget('point-x')] }
    const question: MemoriaNeedsYouQuestion = { category: 'attach_information', id: 'source-1', entry }
    expect(filterMemoriaNeedsYouQuestionsForPoint([question], 'point-x')).toEqual([question])
    expect(filterMemoriaNeedsYouQuestionsForPoint([question], 'point-y')).toEqual([])
  })

  it('assign_resolution : matche via knownIdentityTargets OU sameSubjectSuggestions', () => {
    const knownEntry = { ...resolutionEntry('trace-1', true), knownIdentityTargets: [pointRef('point-x')] }
    const suggestedEntry = { ...resolutionEntry('trace-2', true), sameSubjectSuggestions: [pointRef('point-y')] }
    const q1: MemoriaNeedsYouQuestion = { category: 'assign_resolution', id: 'trace-1', entry: knownEntry }
    const q2: MemoriaNeedsYouQuestion = { category: 'assign_resolution', id: 'trace-2', entry: suggestedEntry }
    expect(filterMemoriaNeedsYouQuestionsForPoint([q1], 'point-x')).toEqual([q1])
    expect(filterMemoriaNeedsYouQuestionsForPoint([q2], 'point-y')).toEqual([q2])
    expect(filterMemoriaNeedsYouQuestionsForPoint([q1, q2], 'point-z')).toEqual([])
  })

  it('confirm_trackability et clarify_evidence : toujours exclues, aucune référence Point possible', () => {
    const trackability: MemoriaNeedsYouQuestion = { category: 'confirm_trackability', id: 'trace-1', entry: trackabilityEntry('trace-1', true) }
    const evidence: MemoriaNeedsYouQuestion = { category: 'clarify_evidence', id: 'trace-1', entry: evidenceScopeEntry('trace-1', 'TRACKABILITY_UNDETERMINED') }
    expect(filterMemoriaNeedsYouQuestionsForPoint([trackability, evidence], 'any-point')).toEqual([])
  })
})

// Lot UX Point 1.1 (mandat Vincent) — filterMemoriaNeedsYouQuestionsForSubject : contrairement au
// filtre Point, les 5 catégories portent toutes un subjectId/subject vérifié dans leur source —
// aucune n'est structurellement exclue.
describe('filterMemoriaNeedsYouQuestionsForSubject (lot UX Point 1.1)', () => {
  it('duplicate_points : matche pointA OU pointB via leur subjectId', () => {
    const entry = {
      ...consolidationEntry('pair-1'),
      pointA: { ...pointSide('a'), subjectId: 'subj-1' },
      pointB: { ...pointSide('b'), subjectId: 'subj-2' },
    }
    const q: MemoriaNeedsYouQuestion = { category: 'duplicate_points', id: 'pair-1', entry }
    expect(filterMemoriaNeedsYouQuestionsForSubject([q], 'subj-1')).toEqual([q])
    expect(filterMemoriaNeedsYouQuestionsForSubject([q], 'subj-2')).toEqual([q])
    expect(filterMemoriaNeedsYouQuestionsForSubject([q], 'subj-other')).toEqual([])
  })

  it('attach_information : matche si un target référence ce sujet (champ `subject`, pas `subjectId`)', () => {
    const entry = { ...traceIdentityEntry('source-1'), targets: [{ ...traceTarget('point-x'), subject: 'subj-1' }] }
    const q: MemoriaNeedsYouQuestion = { category: 'attach_information', id: 'source-1', entry }
    expect(filterMemoriaNeedsYouQuestionsForSubject([q], 'subj-1')).toEqual([q])
    expect(filterMemoriaNeedsYouQuestionsForSubject([q], 'subj-2')).toEqual([])
  })

  it('confirm_trackability : matche via son subjectId (contrairement au filtre Point, JAMAIS exclue)', () => {
    const entry = { ...trackabilityEntry('trace-1', true), subjectId: 'subj-1' }
    const q: MemoriaNeedsYouQuestion = { category: 'confirm_trackability', id: 'trace-1', entry }
    expect(filterMemoriaNeedsYouQuestionsForSubject([q], 'subj-1')).toEqual([q])
    expect(filterMemoriaNeedsYouQuestionsForSubject([q], 'subj-2')).toEqual([])
  })

  it('clarify_evidence : matche via son subjectId (contrairement au filtre Point, JAMAIS exclue)', () => {
    const entry = { ...evidenceScopeEntry('trace-1', 'TRACKABILITY_UNDETERMINED'), subjectId: 'subj-1' }
    const q: MemoriaNeedsYouQuestion = { category: 'clarify_evidence', id: 'trace-1', entry }
    expect(filterMemoriaNeedsYouQuestionsForSubject([q], 'subj-1')).toEqual([q])
    expect(filterMemoriaNeedsYouQuestionsForSubject([q], 'subj-2')).toEqual([])
  })

  it('assign_resolution : matche via knownIdentityTargets OU sameSubjectSuggestions', () => {
    const knownEntry = { ...resolutionEntry('trace-1', true), knownIdentityTargets: [{ ...pointRef('point-x'), subjectId: 'subj-1' }] }
    const suggestedEntry = { ...resolutionEntry('trace-2', true), sameSubjectSuggestions: [{ ...pointRef('point-y'), subjectId: 'subj-2' }] }
    const q1: MemoriaNeedsYouQuestion = { category: 'assign_resolution', id: 'trace-1', entry: knownEntry }
    const q2: MemoriaNeedsYouQuestion = { category: 'assign_resolution', id: 'trace-2', entry: suggestedEntry }
    expect(filterMemoriaNeedsYouQuestionsForSubject([q1], 'subj-1')).toEqual([q1])
    expect(filterMemoriaNeedsYouQuestionsForSubject([q2], 'subj-2')).toEqual([q2])
    expect(filterMemoriaNeedsYouQuestionsForSubject([q1, q2], 'subj-other')).toEqual([])
  })
})

// Lot UX Point 1.1 (mandat Vincent) — resolveMemoriaNeedsYouSubjectPointRef : n'affiche le Point
// concerné que lorsqu'un SEUL Point candidat référence ce sujet pour cette question précise ;
// jamais un choix arbitraire parmi plusieurs Points distincts (zéro heuristique).
describe('resolveMemoriaNeedsYouSubjectPointRef (lot UX Point 1.1, zéro heuristique)', () => {
  it('duplicate_points : un seul Point du sujet candidat → retourne ce Point', () => {
    const entry = {
      ...consolidationEntry('pair-1'),
      pointA: { ...pointSide('a'), subjectId: 'subj-1', label: 'Point A' },
      pointB: { ...pointSide('b'), subjectId: 'subj-2', label: 'Point B' },
    }
    const q: MemoriaNeedsYouQuestion = { category: 'duplicate_points', id: 'pair-1', entry }
    expect(resolveMemoriaNeedsYouSubjectPointRef(q, 'subj-1')).toEqual({ pointId: 'a', pointLabel: 'Point A' })
  })

  it('duplicate_points : pointA ET pointB appartiennent au même sujet mais sont des Points DISTINCTS → null (aucun choix arbitraire)', () => {
    const entry = {
      ...consolidationEntry('pair-1'),
      pointA: { ...pointSide('a'), subjectId: 'subj-1' },
      pointB: { ...pointSide('b'), subjectId: 'subj-1' },
    }
    const q: MemoriaNeedsYouQuestion = { category: 'duplicate_points', id: 'pair-1', entry }
    expect(resolveMemoriaNeedsYouSubjectPointRef(q, 'subj-1')).toBeNull()
  })

  it('attach_information : un seul target du sujet → retourne ce Point', () => {
    const entry = { ...traceIdentityEntry('source-1'), targets: [{ ...traceTarget('point-x'), subject: 'subj-1', label: 'Point X' }] }
    const q: MemoriaNeedsYouQuestion = { category: 'attach_information', id: 'source-1', entry }
    expect(resolveMemoriaNeedsYouSubjectPointRef(q, 'subj-1')).toEqual({ pointId: 'point-x', pointLabel: 'Point X' })
  })

  it('attach_information : deux targets distincts du même sujet → null', () => {
    const entry = {
      ...traceIdentityEntry('source-1'),
      targets: [
        { ...traceTarget('point-x'), subject: 'subj-1' },
        { ...traceTarget('point-y'), subject: 'subj-1' },
      ],
    }
    const q: MemoriaNeedsYouQuestion = { category: 'attach_information', id: 'source-1', entry }
    expect(resolveMemoriaNeedsYouSubjectPointRef(q, 'subj-1')).toBeNull()
  })

  it('assign_resolution : un seul candidat (known ou suggéré) du sujet → retourne ce Point', () => {
    const entry = { ...resolutionEntry('trace-1', true), knownIdentityTargets: [{ ...pointRef('point-x'), subjectId: 'subj-1', label: 'Point X' }] }
    const q: MemoriaNeedsYouQuestion = { category: 'assign_resolution', id: 'trace-1', entry }
    expect(resolveMemoriaNeedsYouSubjectPointRef(q, 'subj-1')).toEqual({ pointId: 'point-x', pointLabel: 'Point X' })
  })

  it('assign_resolution : knownIdentityTargets et sameSubjectSuggestions pointent vers des Points distincts du même sujet → null', () => {
    const entry = {
      ...resolutionEntry('trace-1', true),
      knownIdentityTargets: [{ ...pointRef('point-x'), subjectId: 'subj-1' }],
      sameSubjectSuggestions: [{ ...pointRef('point-y'), subjectId: 'subj-1' }],
    }
    const q: MemoriaNeedsYouQuestion = { category: 'assign_resolution', id: 'trace-1', entry }
    expect(resolveMemoriaNeedsYouSubjectPointRef(q, 'subj-1')).toBeNull()
  })

  it('confirm_trackability et clarify_evidence : toujours null, aucune référence Point possible dans leur source', () => {
    const trackability: MemoriaNeedsYouQuestion = { category: 'confirm_trackability', id: 'trace-1', entry: { ...trackabilityEntry('trace-1', true), subjectId: 'subj-1' } }
    const evidence: MemoriaNeedsYouQuestion = { category: 'clarify_evidence', id: 'trace-1', entry: { ...evidenceScopeEntry('trace-1', 'TRACKABILITY_UNDETERMINED'), subjectId: 'subj-1' } }
    expect(resolveMemoriaNeedsYouSubjectPointRef(trackability, 'subj-1')).toBeNull()
    expect(resolveMemoriaNeedsYouSubjectPointRef(evidence, 'subj-1')).toBeNull()
  })
})

// Lot UX Point 1.1 (mandat Vincent) — needsYouQuestionHref : deep-link `?q=<id>` vers la question
// précise, jamais un simple renvoi vers la page générale.
describe('needsYouQuestionHref (lot UX Point 1.1)', () => {
  it('ajoute ?q=<id> à une URL sans query existante', () => {
    expect(needsYouQuestionHref('/sites/site-1/besoin-de-toi', 'q-1')).toBe('/sites/site-1/besoin-de-toi?q=q-1')
  })

  it('ajoute &q=<id> quand une query existe déjà', () => {
    expect(needsYouQuestionHref('/sites/site-1/besoin-de-toi?tab=x', 'q-1')).toBe('/sites/site-1/besoin-de-toi?tab=x&q=q-1')
  })

  it("encode l'identifiant de question", () => {
    expect(needsYouQuestionHref('/sites/site-1/besoin-de-toi', 'q 1&x')).toBe('/sites/site-1/besoin-de-toi?q=q%201%26x')
  })
})
