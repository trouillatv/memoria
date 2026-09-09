// Phase 6E.4A — test UNITAIRE (pur, zéro DB) de buildMemoriaNeedsYouSummary.
//
// Couvre la seule règle métier de cet agrégateur : une pending trace non actionnable par
// evidence unresolved (trackability/resolution) ne produit JAMAIS de question dans sa catégorie
// native — elle n'existe, pour l'humain, que sous 'clarify_evidence' (jamais comptée deux fois,
// jamais perdue).

import { describe, it, expect } from 'vitest'
import {
  buildMemoriaNeedsYouSummary,
  MEMORIA_NEEDS_YOU_CATEGORY_ORDER,
} from '@/lib/knowledge/tracked-point-needs-you-summary'
import type { ConsolidationQueue, ConsolidationQueueEntry, ConsolidationQueuePointSide } from '@/lib/knowledge/tracked-point-consolidation-queue'
import type { TraceIdentityQueue, TraceIdentitySourceEntry } from '@/lib/knowledge/tracked-point-trace-queue'
import type { PendingTrackabilityQueue, PendingTrackabilityQueueEntry } from '@/lib/knowledge/tracked-point-pending-trackability-queue'
import type { PendingResolutionQueue, PendingResolutionQueueEntry } from '@/lib/knowledge/tracked-point-pending-resolution-queue'
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
