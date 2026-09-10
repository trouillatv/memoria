// Phase 6E.2C — test UNITAIRE (pur, zéro DB) de buildTraceIdentityQueue.
//
// Couvre les scénarios Build 5 exigés par Vincent : source 1 cible → 1 question ; source 3
// cibles → 1 question/3 choix ; candidate accepted/déjà associée → disparaît (source vidée
// quitte la file en silence) ; candidate rejected/filtrée par l'appelant → disparaît SEULEMENT
// pour cette cible, les autres cibles de la même source restent ; source devenue fondatrice
// d'un Point → quitte la file TRACE (POINT_TO_POINT_AT_ORIGIN / STALE_NOW_POINT_TO_POINT) ;
// target mergé → jamais d'acceptation silencieuse (STALE_TARGET, visible mais non-actionnable,
// canonicalPointId ≠ pointId exposés distinctement) ; NEEDS_SCOPE_REFINEMENT → visible mais
// non-actionnable ; mix actionnable/bloqué sur une même source → PARTIALLY_ACTIONABLE ;
// invariant fort : aucun candidat converti en paire Point↔Point (deriveCandidatePointPairs)
// ne peut apparaître dans targets[].

import { describe, it, expect } from 'vitest'
import { buildTraceIdentityQueue, type TraceIdentitySourceProposal } from '@/lib/knowledge/tracked-point-trace-queue'
import type { TraceScopePointRow, TraceScopeMemberRow, TraceScopeCandidateInput } from '@/lib/knowledge/tracked-point-trace-scope'
import type { PointReadModelEntry } from '@/lib/knowledge/tracked-point-read-model'

function point(id: string, overrides: Partial<TraceScopePointRow> = {}): TraceScopePointRow {
  return {
    id,
    siteId: 'site-1',
    status: 'active',
    mergedIntoId: null,
    foundingKind: 'manual',
    foundingReference: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function member(trackedPointId: string, subjectThreadId: string, overrides: Partial<TraceScopeMemberRow> = {}): TraceScopeMemberRow {
  return { trackedPointId, subjectThreadId, scope: 'thread', status: 'active', createdAt: '2026-01-01T00:00:00Z', ...overrides }
}

function candidate(
  id: string,
  candidatePointId: string,
  subjectThreadId: string,
  overrides: Partial<TraceScopeCandidateInput> = {},
): TraceScopeCandidateInput {
  return { id, siteId: 'site-1', candidatePointId, subjectThreadId, scope: 'thread', createdAt: '2026-02-01T00:00:00Z', ...overrides }
}

function pointDetail(id: string, overrides: Partial<PointReadModelEntry> = {}): PointReadModelEntry {
  return {
    id,
    siteId: 'site-1',
    ownerCanonicalSubjectId: `subject-${id}`,
    label: `point ${id}`,
    status: 'active',
    mergedIntoId: null,
    canonicalPointId: id,
    identityStatus: 'PROVISIONAL',
    derivedState: 'open',
    foundingKind: 'manual',
    foundingSource: null,
    hasUpstreamDefect: false,
    cboIds: [],
    hardMemberThreadIds: [],
    latestMeaningfulEventAt: null,
    trajectory: [],
    stateBasis: [],
    markers: [],
    documentaryDivergences: [],
    conflicts: [],
    toConfirm: false,
    closedByDecision: false,
    awaitingDecision: false,
    hasDocumentaryDivergence: false,
    hasConflict: false,
    ...overrides,
  }
}

function proposal(id: string, overrides: Partial<TraceIdentitySourceProposal> = {}): TraceIdentitySourceProposal {
  return {
    id,
    label: `proposal ${id}`,
    proposalFamily: 'observation',
    documentId: null,
    documentFilename: null,
    documentType: null,
    documentEffectiveDate: null,
    sourcePage: null,
    sourceExcerpt: null,
    createdAt: '2026-02-01T00:00:00Z',
    ...overrides,
  }
}

describe('buildTraceIdentityQueue', () => {
  it('source à 1 cible → 1 entrée, 1 question binaire', () => {
    const points = [point('A')]
    const details = new Map([['A', pointDetail('A')]])
    const candidates = [candidate('c1', 'A', 'T1')]
    const famillesByThreadId = new Map([['T1', ['observation']]])
    const proposalsByThreadId = new Map([['T1', [proposal('p1')]]])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, [], famillesByThreadId, details, proposalsByThreadId, new Map())

    expect(queue.totalSources).toBe(1)
    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0].sourceThreadId).toBe('T1')
    expect(queue.entries[0].targetCount).toBe(1)
    expect(queue.entries[0].targets[0].actionability).toBe('ACTIONABLE')
    expect(queue.entries[0].evidenceScopeStatus).toBe('ACTIONABLE')
  })

  it('source à 3 cibles → 1 entrée, 3 choix (jamais 3 cartes indépendantes)', () => {
    const points = [point('A'), point('B'), point('C')]
    const details = new Map([
      ['A', pointDetail('A')],
      ['B', pointDetail('B')],
      ['C', pointDetail('C')],
    ])
    const candidates = [candidate('c1', 'A', 'T2'), candidate('c2', 'B', 'T2'), candidate('c3', 'C', 'T2')]
    const famillesByThreadId = new Map([['T2', ['observation']]])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, [], famillesByThreadId, details, new Map(), new Map())

    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0].targetCount).toBe(3)
    expect(queue.entries[0].targets.map((t) => t.pointId).sort()).toEqual(['A', 'B', 'C'])
  })

  it('candidate déjà associée (acceptée) → disparaît, la source vidée quitte la file en silence', () => {
    const points = [point('A')]
    const details = new Map([['A', pointDetail('A')]])
    const candidates = [candidate('c1', 'A', 'T3')]
    // La membership existe déjà (comme après acceptation) — classifyTraceIdentityCandidate
    // renvoie ALREADY_ASSOCIATED pour ce candidat encore techniquement pending en base.
    const members = [member('A', 'T3', { scope: 'thread' })]
    const famillesByThreadId = new Map([['T3', ['observation']]])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, members, famillesByThreadId, details, new Map(), new Map())

    expect(queue.entries).toHaveLength(0)
    expect(queue.totalSources).toBe(0)
  })

  it('candidate rejetée/filtrée par l\'appelant → disparaît SEULEMENT pour cette cible, les autres restent', () => {
    const points = [point('A'), point('B')]
    const details = new Map([
      ['A', pointDetail('A')],
      ['B', pointDetail('B')],
    ])
    // Seul c2 (→B) est transmis : simule c1 (→A) déjà rejeté et exclu par le chargeur en amont
    // (loadTraceIdentityQueue ne charge que status='pending').
    const candidates = [candidate('c2', 'B', 'T4')]
    const famillesByThreadId = new Map([['T4', ['observation']]])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, [], famillesByThreadId, details, new Map(), new Map())

    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0].targetCount).toBe(1)
    expect(queue.entries[0].targets[0].pointId).toBe('B')
  })

  it('source devenue fondatrice d\'un Point APRÈS le candidat (STALE_NOW_POINT_TO_POINT) → quitte la file TRACE', () => {
    const points = [point('A'), point('OWN', { foundingKind: 'trackable_condition', foundingReference: 'T5', createdAt: '2026-03-01T00:00:00Z' })]
    const details = new Map([
      ['A', pointDetail('A')],
      ['OWN', pointDetail('OWN')],
    ])
    const candidates = [candidate('c1', 'A', 'T5', { createdAt: '2026-02-01T00:00:00Z' })]
    const famillesByThreadId = new Map([['T5', ['observation']]])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, [], famillesByThreadId, details, new Map(), new Map())

    expect(queue.entries).toHaveLength(0)
  })

  it('source déjà fondatrice à l\'origine (POINT_TO_POINT_AT_ORIGIN) → quitte aussi la file TRACE', () => {
    const points = [point('A'), point('OWN', { foundingKind: 'trackable_condition', foundingReference: 'T6', createdAt: '2026-01-01T00:00:00Z' })]
    const details = new Map([
      ['A', pointDetail('A')],
      ['OWN', pointDetail('OWN')],
    ])
    const candidates = [candidate('c1', 'A', 'T6', { createdAt: '2026-02-01T00:00:00Z' })]
    const famillesByThreadId = new Map([['T6', ['observation']]])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, [], famillesByThreadId, details, new Map(), new Map())

    expect(queue.entries).toHaveLength(0)
  })

  it('target mergé depuis la pose du candidat → STALE_TARGET, visible mais non-actionnable, canonicalPointId ≠ pointId', () => {
    const points = [point('A', { status: 'merged', mergedIntoId: 'B' }), point('B')]
    const details = new Map([
      ['A', pointDetail('A')],
      ['B', pointDetail('B')],
    ])
    const candidates = [candidate('c1', 'A', 'T7')]
    const famillesByThreadId = new Map([['T7', ['observation']]])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, [], famillesByThreadId, details, new Map(), new Map())

    expect(queue.entries).toHaveLength(1)
    const target = queue.entries[0].targets[0]
    expect(target.pointId).toBe('A')
    expect(target.canonicalPointId).toBe('B')
    expect(target.actionability).toBe('STALE_TARGET')
    expect(queue.entries[0].evidenceScopeStatus).toBe('BLOCKED')
  })

  it('NEEDS_SCOPE_REFINEMENT → visible mais non-actionnable, raison INSUFFICIENT_EVIDENCE_SCOPE', () => {
    const points = [point('A')]
    const details = new Map([['A', pointDetail('A')]])
    const candidates = [candidate('c1', 'A', 'T8')]
    const famillesByThreadId = new Map([['T8', ['action', 'decision']]])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, [], famillesByThreadId, details, new Map(), new Map())

    expect(queue.entries).toHaveLength(1)
    const target = queue.entries[0].targets[0]
    expect(target.actionability).toBe('NEEDS_SCOPE_REFINEMENT')
    expect(target.blockerReason).toBe('INSUFFICIENT_EVIDENCE_SCOPE')
    expect(queue.entries[0].evidenceScopeStatus).toBe('BLOCKED')
  })

  it('mix actionnable (proposal_set) + bloqué (thread multi-famille) sur la même source → PARTIALLY_ACTIONABLE, scope=mixed', () => {
    const points = [point('A'), point('B')]
    const details = new Map([
      ['A', pointDetail('A')],
      ['B', pointDetail('B')],
    ])
    const candidates = [
      candidate('c1', 'A', 'T9', { scope: 'thread' }),
      candidate('c2', 'B', 'T9', { scope: 'proposal_set' }),
    ]
    const famillesByThreadId = new Map([['T9', ['action', 'decision']]])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, [], famillesByThreadId, details, new Map(), new Map())

    expect(queue.entries).toHaveLength(1)
    const entry = queue.entries[0]
    expect(entry.targetCount).toBe(2)
    expect(entry.scope).toBe('mixed')
    expect(entry.evidenceScopeStatus).toBe('PARTIALLY_ACTIONABLE')
    const byPoint = Object.fromEntries(entry.targets.map((t) => [t.pointId, t.actionability]))
    expect(byPoint.A).toBe('NEEDS_SCOPE_REFINEMENT')
    expect(byPoint.B).toBe('ACTIONABLE')
  })

  it('target introuvable (TARGET_MISSING) → visible mais non-actionnable', () => {
    const points: TraceScopePointRow[] = []
    const candidates = [candidate('c1', 'GHOST', 'T10')]
    const famillesByThreadId = new Map([['T10', ['observation']]])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, [], famillesByThreadId, new Map(), new Map(), new Map())

    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0].targets[0].actionability).toBe('TARGET_MISSING')
  })

  it('invariant fort : aucun candidat POINT_TO_POINT (origine ou dérive) ne fuit jamais dans targets[], quel que soit le mélange de sources', () => {
    const points = [
      point('A'),
      point('B'),
      point('OWN1', { foundingKind: 'trackable_condition', foundingReference: 'T11', createdAt: '2026-03-01T00:00:00Z' }),
    ]
    const details = new Map([
      ['A', pointDetail('A')],
      ['B', pointDetail('B')],
      ['OWN1', pointDetail('OWN1')],
    ])
    const candidates = [
      candidate('safe', 'A', 'T12', { createdAt: '2026-02-01T00:00:00Z' }),
      candidate('stale', 'B', 'T11', { createdAt: '2026-02-01T00:00:00Z' }),
    ]
    const famillesByThreadId = new Map([
      ['T11', ['observation']],
      ['T12', ['observation']],
    ])

    const queue = buildTraceIdentityQueue('site-1', candidates, points, [], famillesByThreadId, details, new Map(), new Map())

    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0].sourceThreadId).toBe('T12')
    expect(queue.entries.some((e) => e.targets.some((t) => t.classification.category === 'STALE_NOW_POINT_TO_POINT'))).toBe(false)
  })

  it('dernier candidat rejeté mais pending trace IDENTITY_UNRESOLVED encore ouverte → entrée FALLBACK visible (mandat Vincent)', () => {
    // Aucun candidat transmis pour T13 (tous rejetés, exclus en amont par le chargeur) : sans le
    // second passage FALLBACK, cette source disparaîtrait totalement de la file alors que sa
    // tracked_point_pending_trace reste 'pending' en base.
    const candidates: TraceScopeCandidateInput[] = []
    const proposalsByThreadId = new Map([['T13', [proposal('p13', { label: 'Sujet T13' })]]])
    const pendingTraceIdByThreadId = new Map([['T13', 'trace-13']])

    const queue = buildTraceIdentityQueue(
      'site-1',
      candidates,
      [],
      [],
      new Map(),
      new Map(),
      proposalsByThreadId,
      new Map(),
      pendingTraceIdByThreadId,
    )

    expect(queue.entries).toHaveLength(1)
    const entry = queue.entries[0]
    expect(entry.sourceThreadId).toBe('T13')
    expect(entry.targetCount).toBe(0)
    expect(entry.targets).toEqual([])
    expect(entry.evidenceScopeStatus).toBe('BLOCKED')
    expect(entry.pendingTraceId).toBe('trace-13')
    expect(entry.needsFreeIdentityResolution).toBe(true)
    expect(entry.sourceLabel).toBe('Sujet T13')
  })

  it('source avec pending trace ET candidats encore actionnables → une seule entrée normale, pas de doublon FALLBACK', () => {
    const points = [point('A')]
    const details = new Map([['A', pointDetail('A')]])
    const candidates = [candidate('c1', 'A', 'T14')]
    const famillesByThreadId = new Map([['T14', ['observation']]])
    const pendingTraceIdByThreadId = new Map([['T14', 'trace-14']])

    const queue = buildTraceIdentityQueue(
      'site-1',
      candidates,
      points,
      [],
      famillesByThreadId,
      details,
      new Map(),
      new Map(),
      pendingTraceIdByThreadId,
    )

    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0].targetCount).toBe(1)
    expect(queue.entries[0].needsFreeIdentityResolution).toBe(false)
    expect(queue.entries[0].pendingTraceId).toBe('trace-14')
  })

  it('file vide : totalSources=0, totalTargets=0', () => {
    const queue = buildTraceIdentityQueue('site-1', [], [], [], new Map(), new Map(), new Map(), new Map())
    expect(queue.totalSources).toBe(0)
    expect(queue.totalTargets).toBe(0)
    expect(queue.entries).toEqual([])
  })
})
