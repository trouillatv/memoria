import { describe, expect, it } from 'vitest'
import {
  resolveCanonicalPointId,
  chooseCanonicalMergeTarget,
  buildPointMergeComponents,
  deriveCandidatePointPairs,
  computeConnectedComponents,
  PointMergeCycleError,
  PointMergeTargetMissingError,
  PointMergeTargetRetiredError,
  PointMergeCrossSiteError,
  PointMergeAmbiguousCanonicalError,
  type MergeGraphPoint,
  type CandidatePairPointRow,
  type CandidatePairMemberRow,
  type CandidatePairIdentityCandidateRow,
} from '@/lib/knowledge/tracked-point-merge'

const point = (overrides: Partial<MergeGraphPoint> = {}): MergeGraphPoint => ({
  id: 'p1',
  siteId: 'site-1',
  status: 'active',
  mergedIntoId: null,
  identityStatus: 'CONFIRMED',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

describe('resolveCanonicalPointId', () => {
  it('un Point actif est son propre canonique', () => {
    const a = point({ id: 'a' })
    const byId = new Map([['a', a]])
    expect(resolveCanonicalPointId('a', byId)).toBe('a')
  })

  it('résout un merge simple A->B', () => {
    const a = point({ id: 'a', status: 'merged', mergedIntoId: 'b' })
    const b = point({ id: 'b' })
    const byId = new Map([['a', a], ['b', b]])
    expect(resolveCanonicalPointId('a', byId)).toBe('b')
  })

  it('résout une chaîne A->B->C', () => {
    const a = point({ id: 'a', status: 'merged', mergedIntoId: 'b' })
    const b = point({ id: 'b', status: 'merged', mergedIntoId: 'c' })
    const c = point({ id: 'c' })
    const byId = new Map([['a', a], ['b', b], ['c', c]])
    expect(resolveCanonicalPointId('a', byId)).toBe('c')
  })

  it('lève PointMergeCycleError sur un cycle A<->B', () => {
    const a = point({ id: 'a', status: 'merged', mergedIntoId: 'b' })
    const b = point({ id: 'b', status: 'merged', mergedIntoId: 'a' })
    const byId = new Map([['a', a], ['b', b]])
    expect(() => resolveCanonicalPointId('a', byId)).toThrow(PointMergeCycleError)
  })

  it('lève PointMergeTargetMissingError si merged sans merged_into_id', () => {
    const a = point({ id: 'a', status: 'merged', mergedIntoId: null })
    const byId = new Map([['a', a]])
    expect(() => resolveCanonicalPointId('a', byId)).toThrow(PointMergeTargetMissingError)
  })

  it('lève PointMergeTargetMissingError si la cible est absente de la carte', () => {
    const a = point({ id: 'a', status: 'merged', mergedIntoId: 'ghost' })
    const byId = new Map([['a', a]])
    expect(() => resolveCanonicalPointId('a', byId)).toThrow(PointMergeTargetMissingError)
  })

  it('lève PointMergeTargetMissingError si le point de départ est absent', () => {
    const byId = new Map<string, MergeGraphPoint>()
    expect(() => resolveCanonicalPointId('ghost', byId)).toThrow(PointMergeTargetMissingError)
  })

  it('lève PointMergeCrossSiteError si la cible est sur un autre site', () => {
    const a = point({ id: 'a', siteId: 'site-1', status: 'merged', mergedIntoId: 'b' })
    const b = point({ id: 'b', siteId: 'site-2' })
    const byId = new Map([['a', a], ['b', b]])
    expect(() => resolveCanonicalPointId('a', byId)).toThrow(PointMergeCrossSiteError)
  })

  it('lève PointMergeTargetRetiredError si la cible est retired', () => {
    const a = point({ id: 'a', status: 'merged', mergedIntoId: 'b' })
    const b = point({ id: 'b', status: 'retired' })
    const byId = new Map([['a', a], ['b', b]])
    expect(() => resolveCanonicalPointId('a', byId)).toThrow(PointMergeTargetRetiredError)
  })
})

describe('chooseCanonicalMergeTarget', () => {
  it('CONFIRMED bat PROVISIONAL quel que soit le sens', () => {
    const confirmed = point({ id: 'a', identityStatus: 'CONFIRMED' })
    const provisional = point({ id: 'b', identityStatus: 'PROVISIONAL' })
    expect(chooseCanonicalMergeTarget(confirmed, provisional)).toBe('a')
    expect(chooseCanonicalMergeTarget(provisional, confirmed)).toBe('a')
  })

  it('à statut égal, le created_at le plus ancien gagne', () => {
    const older = point({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' })
    const newer = point({ id: 'b', createdAt: '2026-02-01T00:00:00.000Z' })
    expect(chooseCanonicalMergeTarget(older, newer)).toBe('a')
    expect(chooseCanonicalMergeTarget(newer, older)).toBe('a')
  })

  it('à statut et created_at égaux, UUID lexicographiquement plus petit gagne', () => {
    const a = point({ id: 'aaa' })
    const b = point({ id: 'bbb' })
    expect(chooseCanonicalMergeTarget(a, b)).toBe('aaa')
    expect(chooseCanonicalMergeTarget(b, a)).toBe('aaa')
  })

  it('lève PointMergeAmbiguousCanonicalError si un côté est CONFLICTED', () => {
    const a = point({ id: 'a', identityStatus: 'CONFLICTED' })
    const b = point({ id: 'b' })
    expect(() => chooseCanonicalMergeTarget(a, b)).toThrow(PointMergeAmbiguousCanonicalError)
  })
})

describe('buildPointMergeComponents', () => {
  it('chaque point actif isolé forme son propre composant singleton', () => {
    const points = [point({ id: 'a' }), point({ id: 'b' })]
    const components = buildPointMergeComponents(points)
    expect(components.get('a')).toEqual({ canonicalPointId: 'a', memberPointIds: ['a'] })
    expect(components.get('b')).toEqual({ canonicalPointId: 'b', memberPointIds: ['b'] })
  })

  it('regroupe A fusionné dans B sous le canonique B', () => {
    const points = [
      point({ id: 'a', status: 'merged', mergedIntoId: 'b' }),
      point({ id: 'b' }),
    ]
    const components = buildPointMergeComponents(points)
    expect(components.size).toBe(1)
    expect(components.get('b')).toEqual({ canonicalPointId: 'b', memberPointIds: ['a', 'b'] })
  })

  it('regroupe une chaîne A->B->C sous le canonique C', () => {
    const points = [
      point({ id: 'a', status: 'merged', mergedIntoId: 'b' }),
      point({ id: 'b', status: 'merged', mergedIntoId: 'c' }),
      point({ id: 'c' }),
    ]
    const components = buildPointMergeComponents(points)
    expect(components.size).toBe(1)
    const comp = components.get('c')
    expect(comp?.canonicalPointId).toBe('c')
    expect(comp?.memberPointIds.sort()).toEqual(['a', 'b', 'c'])
  })

  it('garantit une couverture totale : chaque point.id apparaît dans exactement un composant', () => {
    const points = [
      point({ id: 'a', status: 'merged', mergedIntoId: 'b' }),
      point({ id: 'b' }),
      point({ id: 'c' }),
    ]
    const components = buildPointMergeComponents(points)
    const allMembers = [...components.values()].flatMap((c) => c.memberPointIds)
    expect(allMembers.sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('deriveCandidatePointPairs', () => {
  const cboPoint = (id: string, siteId = 'site-1'): CandidatePairPointRow => ({
    id,
    siteId,
    status: 'active',
    mergedIntoId: null,
    foundingKind: 'cbo',
    foundingReference: null,
  })

  it('ignore un candidat TRACE_TO_POINT (trace sans Point propre)', () => {
    const points = [cboPoint('target')]
    const candidates: CandidatePairIdentityCandidateRow[] = [
      { id: 'c1', siteId: 'site-1', candidatePointId: 'target', subjectThreadId: 'thread-orphan', status: 'pending' },
    ]
    const pairs = deriveCandidatePointPairs(points, [], candidates)
    expect(pairs).toEqual([])
  })

  it('construit une paire POINT_TO_POINT via un membre HARD scope=thread', () => {
    const points = [cboPoint('a'), cboPoint('b')]
    const members: CandidatePairMemberRow[] = [
      { trackedPointId: 'a', subjectThreadId: 'thread-1', scope: 'thread', status: 'active' },
    ]
    const candidates: CandidatePairIdentityCandidateRow[] = [
      { id: 'c1', siteId: 'site-1', candidatePointId: 'b', subjectThreadId: 'thread-1', status: 'pending' },
    ]
    const pairs = deriveCandidatePointPairs(points, members, candidates)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].pointAId).toBe('a')
    expect(pairs[0].pointBId).toBe('b')
    expect(pairs[0].reciprocal).toBe(false)
  })

  it('collapse les paires réciproques A->B et B->A en une seule avec reciprocal=true', () => {
    const points = [cboPoint('a'), cboPoint('b')]
    const members: CandidatePairMemberRow[] = [
      { trackedPointId: 'a', subjectThreadId: 'thread-1', scope: 'thread', status: 'active' },
      { trackedPointId: 'b', subjectThreadId: 'thread-2', scope: 'thread', status: 'active' },
    ]
    const candidates: CandidatePairIdentityCandidateRow[] = [
      { id: 'c1', siteId: 'site-1', candidatePointId: 'b', subjectThreadId: 'thread-1', status: 'pending' },
      { id: 'c2', siteId: 'site-1', candidatePointId: 'a', subjectThreadId: 'thread-2', status: 'pending' },
    ]
    const pairs = deriveCandidatePointPairs(points, members, candidates)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].reciprocal).toBe(true)
    expect(pairs[0].candidateIds.sort()).toEqual(['c1', 'c2'])
  })

  it('retire une self-pair après canonicalisation (déjà consolidées) sans la marquer rejetée', () => {
    const points: CandidatePairPointRow[] = [
      { ...cboPoint('a'), status: 'merged', mergedIntoId: 'b' },
      cboPoint('b'),
    ]
    const members: CandidatePairMemberRow[] = [
      { trackedPointId: 'a', subjectThreadId: 'thread-1', scope: 'thread', status: 'active' },
    ]
    const candidates: CandidatePairIdentityCandidateRow[] = [
      { id: 'c1', siteId: 'site-1', candidatePointId: 'b', subjectThreadId: 'thread-1', status: 'pending' },
    ]
    const pairs = deriveCandidatePointPairs(points, members, candidates)
    expect(pairs).toEqual([])
  })

  it('renomme automatiquement une paire après un merge de chaîne (A déjà fusionné dans B devient B->C)', () => {
    const points: CandidatePairPointRow[] = [
      { ...cboPoint('a'), status: 'merged', mergedIntoId: 'b' },
      cboPoint('b'),
      cboPoint('c'),
    ]
    const members: CandidatePairMemberRow[] = [
      { trackedPointId: 'a', subjectThreadId: 'thread-1', scope: 'thread', status: 'active' },
    ]
    const candidates: CandidatePairIdentityCandidateRow[] = [
      { id: 'c1', siteId: 'site-1', candidatePointId: 'c', subjectThreadId: 'thread-1', status: 'pending' },
    ]
    const pairs = deriveCandidatePointPairs(points, members, candidates)
    expect(pairs).toHaveLength(1)
    expect([pairs[0].pointAId, pairs[0].pointBId].sort()).toEqual(['b', 'c'])
  })

  it('ignore les candidats non pending (accepted/rejected)', () => {
    const points = [cboPoint('a'), cboPoint('b')]
    const members: CandidatePairMemberRow[] = [
      { trackedPointId: 'a', subjectThreadId: 'thread-1', scope: 'thread', status: 'active' },
    ]
    const candidates: CandidatePairIdentityCandidateRow[] = [
      { id: 'c1', siteId: 'site-1', candidatePointId: 'b', subjectThreadId: 'thread-1', status: 'accepted' },
      { id: 'c2', siteId: 'site-1', candidatePointId: 'b', subjectThreadId: 'thread-1', status: 'rejected' },
    ]
    const pairs = deriveCandidatePointPairs(points, members, candidates)
    expect(pairs).toEqual([])
  })

  it('ignore un candidat dont la cible candidate_point_id est introuvable', () => {
    const points = [cboPoint('a')]
    const members: CandidatePairMemberRow[] = [
      { trackedPointId: 'a', subjectThreadId: 'thread-1', scope: 'thread', status: 'active' },
    ]
    const candidates: CandidatePairIdentityCandidateRow[] = [
      { id: 'c1', siteId: 'site-1', candidatePointId: 'ghost', subjectThreadId: 'thread-1', status: 'pending' },
    ]
    const pairs = deriveCandidatePointPairs(points, members, candidates)
    expect(pairs).toEqual([])
  })
})

describe('computeConnectedComponents', () => {
  it('regroupe les noeuds reliés transitivement et sépare les composantes disjointes', () => {
    const edges = [
      { a: 'a', b: 'b' },
      { a: 'b', b: 'c' },
      { a: 'x', b: 'y' },
    ]
    const groups = computeConnectedComponents(edges).map((g) => g.sort()).sort()
    expect(groups).toEqual([['a', 'b', 'c'], ['x', 'y']])
  })
})
