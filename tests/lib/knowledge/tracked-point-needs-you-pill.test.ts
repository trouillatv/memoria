import { describe, expect, it } from 'vitest'
import { computeMemoriaNeedsYouPill } from '@/lib/knowledge/tracked-point-needs-you-pill'
import type { MemoriaNeedsYouSummary, MemoriaNeedsYouQuestion } from '@/lib/knowledge/tracked-point-needs-you-summary'
import type { ConsolidationQueuePointSide } from '@/lib/knowledge/tracked-point-consolidation-queue'

function pointSide(derivedState: string | null): ConsolidationQueuePointSide {
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
  } as ConsolidationQueuePointSide
}

function duplicatePointsQuestion(id: string, derivedStateA: string | null, derivedStateB: string | null): MemoriaNeedsYouQuestion {
  return {
    category: 'duplicate_points',
    id,
    entry: {
      pairId: id,
      siteId: 'site-1',
      pointA: pointSide(derivedStateA),
      pointB: pointSide(derivedStateB),
      candidateIds: [],
      reciprocal: false,
      componentId: 'component-1',
      componentSize: 2,
    },
  } as MemoriaNeedsYouQuestion
}

function summary(overrides: Partial<MemoriaNeedsYouSummary>): MemoriaNeedsYouSummary {
  return {
    siteId: 'site-1',
    totalCount: 0,
    categories: [],
    questions: [],
    latestPvDate: null,
    latestPvCount: 0,
    historicalCount: 0,
    ...overrides,
  }
}

describe('computeMemoriaNeedsYouPill', () => {
  it('totalCount 0 -> null (aucune pilule)', () => {
    expect(computeMemoriaNeedsYouPill(summary({}))).toBeNull()
  })

  it('activite PV recente, aucune priorite -> gabarit par defaut', () => {
    const questions = [duplicatePointsQuestion('a', 'resolved', 'resolved')]
    const result = computeMemoriaNeedsYouPill(
      summary({ totalCount: 6, latestPvCount: 6, historicalCount: 0, questions }),
    )
    expect(result).toEqual({ tone: 'default', priorityCount: 0, label: 'MemorIA · 6 questions sur le dernier PV' })
  })

  it('activite PV recente + un seul signal -> singulier "question"', () => {
    const result = computeMemoriaNeedsYouPill(
      summary({ totalCount: 1, latestPvCount: 1, historicalCount: 0, questions: [] }),
    )
    expect(result?.label).toBe('MemorIA · 1 question sur le dernier PV')
  })

  it('activite PV recente + priorite reelle -> gabarit priorite avec compte PRIORITAIRE', () => {
    const questions = [
      duplicatePointsQuestion('a', 'reopened', 'resolved'),
      duplicatePointsQuestion('b', 'conflict', 'open'),
      duplicatePointsQuestion('c', 'resolved', 'resolved'),
    ]
    const result = computeMemoriaNeedsYouPill(
      summary({ totalCount: 6, latestPvCount: 6, historicalCount: 0, questions }),
    )
    expect(result).toEqual({
      tone: 'priority',
      priorityCount: 2,
      label: 'MemorIA · 2 importantes · 6 sur le dernier PV',
    })
  })

  it('une seule priorite -> singulier "importante"', () => {
    const questions = [duplicatePointsQuestion('a', 'reopened', 'resolved')]
    const result = computeMemoriaNeedsYouPill(
      summary({ totalCount: 6, latestPvCount: 6, historicalCount: 5, questions }),
    )
    expect(result?.label).toBe('MemorIA · 1 importante · 6 sur le dernier PV')
  })

  it('aucune activite PV recente -> gabarit historique discret, jamais de total brut', () => {
    const result = computeMemoriaNeedsYouPill(
      summary({ totalCount: 38, latestPvCount: 0, historicalCount: 38, questions: [] }),
    )
    expect(result).toEqual({ tone: 'historical', priorityCount: 0, label: '38 clarifications historiques' })
  })

  it('historique + un seul element -> singulier', () => {
    const result = computeMemoriaNeedsYouPill(
      summary({ totalCount: 1, latestPvCount: 0, historicalCount: 1, questions: [] }),
    )
    expect(result?.label).toBe('1 clarification historique')
  })
})
