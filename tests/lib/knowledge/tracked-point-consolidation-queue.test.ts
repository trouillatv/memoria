// Phase 6E.1C — test UNITAIRE (pur, zéro DB) de buildConsolidationQueue.
//
// Couvre déliverable 3 (une ligne par paire, jamais par composante ; nombres recalculés,
// jamais codés en dur) et déliverable 4 (aucun type/agrégat ne permet une action groupée sur
// une composante de taille > 2 — vérifié en constatant que 3 paires d'une composante de 3
// Points restent 3 entrées distinctes, chacune avec sa propre candidateIds).

import { describe, it, expect } from 'vitest'
import {
  buildConsolidationQueue,
  type ConsolidationQueuePointSide,
} from '@/lib/knowledge/tracked-point-consolidation-queue'
import type { CandidatePointPair } from '@/lib/knowledge/tracked-point-merge'
import type { TrackedPointConsolidationPointDetail } from '@/lib/db/tracked-point-consolidation'

function detail(id: string, overrides: Partial<TrackedPointConsolidationPointDetail> = {}): TrackedPointConsolidationPointDetail {
  return { id, label: `point ${id}`, status: 'active', identityStatus: 'PROVISIONAL', ...overrides }
}

function pair(pointAId: string, pointBId: string, candidateIds: string[], overrides: Partial<CandidatePointPair> = {}): CandidatePointPair {
  return {
    pairKey: `${pointAId}~${pointBId}`,
    pointAId,
    pointBId,
    siteId: 'site-1',
    candidateIds,
    reciprocal: false,
    ...overrides,
  }
}

describe('buildConsolidationQueue', () => {
  it('produit une entrée par paire, jamais par composante', () => {
    const points = new Map([
      ['a', detail('a')],
      ['b', detail('b')],
    ])
    const pairs = [pair('a', 'b', ['cand-1'])]

    const queue = buildConsolidationQueue('site-1', pairs, points, new Map(), new Map())

    expect(queue.totalPairs).toBe(1)
    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0].pairId).toBe('a~b')
    expect(queue.entries[0].candidateIds).toEqual(['cand-1'])
    expect(queue.complexComponentCount).toBe(0)
  })

  it('componentSize > 2 : reste UNE ligne par paire, jamais une action groupée', () => {
    // Composante a-b-c (3 Points, 2 arêtes candidates : a~b et b~c) : la structure ne permet
    // aucun agrégat "grappe" — deux ConsolidationQueueEntry distinctes, chacune sa propre paire.
    const points = new Map([
      ['a', detail('a')],
      ['b', detail('b')],
      ['c', detail('c')],
    ])
    const pairs = [pair('a', 'b', ['cand-ab']), pair('b', 'c', ['cand-bc'])]

    const queue = buildConsolidationQueue('site-1', pairs, points, new Map(), new Map())

    expect(queue.totalPairs).toBe(2)
    expect(queue.entries.map((e) => e.pairId).sort()).toEqual(['a~b', 'b~c'])
    expect(queue.entries.every((e) => e.componentSize === 3)).toBe(true)
    const componentIds = new Set(queue.entries.map((e) => e.componentId))
    expect(componentIds.size).toBe(1) // même composante, même componentId
    expect(queue.complexComponentCount).toBe(1)
  })

  it('componentId stable indépendamment de l\'ordre des paires en entrée', () => {
    const points = new Map([
      ['a', detail('a')],
      ['b', detail('b')],
      ['c', detail('c')],
    ])
    const pairsInOrder = [pair('a', 'b', ['cand-ab']), pair('b', 'c', ['cand-bc'])]
    const pairsReversed = [pair('b', 'c', ['cand-bc']), pair('a', 'b', ['cand-ab'])]

    const queueA = buildConsolidationQueue('site-1', pairsInOrder, points, new Map(), new Map())
    const queueB = buildConsolidationQueue('site-1', pairsReversed, points, new Map(), new Map())

    const idsA = new Set(queueA.entries.map((e) => e.componentId))
    const idsB = new Set(queueB.entries.map((e) => e.componentId))
    expect(idsA).toEqual(idsB)
  })

  it('componentSize=2 pour deux paires disjointes (deux composantes distinctes)', () => {
    const points = new Map([
      ['a', detail('a')],
      ['b', detail('b')],
      ['c', detail('c')],
      ['d', detail('d')],
    ])
    const pairs = [pair('a', 'b', ['cand-ab']), pair('c', 'd', ['cand-cd'])]

    const queue = buildConsolidationQueue('site-1', pairs, points, new Map(), new Map())

    expect(queue.entries.every((e) => e.componentSize === 2)).toBe(true)
    expect(queue.complexComponentCount).toBe(0)
    const componentIds = new Set(queue.entries.map((e) => e.componentId))
    expect(componentIds.size).toBe(2)
  })

  it('cboCount/hardMemberCount recalculés depuis les maps fournies, jamais codés en dur', () => {
    const points = new Map([
      ['a', detail('a')],
      ['b', detail('b')],
    ])
    const pairs = [pair('a', 'b', ['cand-1'])]
    const cboCounts = new Map([['a', 3], ['b', 0]])
    const memberCounts = new Map([['a', 1]])

    const queue = buildConsolidationQueue('site-1', pairs, points, cboCounts, memberCounts)

    const entry = queue.entries[0]
    const sideA: ConsolidationQueuePointSide = entry.pointA
    const sideB: ConsolidationQueuePointSide = entry.pointB
    expect(sideA.cboCount).toBe(3)
    expect(sideA.hardMemberCount).toBe(1)
    expect(sideB.cboCount).toBe(0)
    expect(sideB.hardMemberCount).toBe(0) // absent de la map → 0 légitime, pas un masquage
  })

  it('lève si une extrémité de paire n\'a pas de détail chargé (incohérence jamais silencieuse)', () => {
    const points = new Map([['a', detail('a')]]) // 'b' absent
    const pairs = [pair('a', 'b', ['cand-1'])]

    expect(() => buildConsolidationQueue('site-1', pairs, points, new Map(), new Map())).toThrow(/introuvable/)
  })

  it('file vide : totalPairs=0, complexComponentCount=0', () => {
    const queue = buildConsolidationQueue('site-1', [], new Map(), new Map(), new Map())
    expect(queue.totalPairs).toBe(0)
    expect(queue.entries).toEqual([])
    expect(queue.complexComponentCount).toBe(0)
  })
})
