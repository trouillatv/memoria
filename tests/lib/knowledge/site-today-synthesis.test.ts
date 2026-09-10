import { describe, expect, it } from 'vitest'
import { computeSiteTodaySynthesis } from '@/lib/knowledge/site-today-synthesis'
import type { PointReadModelEntry } from '@/lib/knowledge/tracked-point-read-model'

function point(overrides: Partial<PointReadModelEntry>): PointReadModelEntry {
  return {
    id: 'p1',
    siteId: 's1',
    ownerCanonicalSubjectId: 'subj-1',
    label: 'Extincteurs hall A',
    status: 'active',
    mergedIntoId: null,
    canonicalPointId: 'p1',
    identityStatus: 'CONFIRMED',
    derivedState: 'open',
    foundingKind: 'cbo',
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

const TODAY = '2026-09-10'

describe('site-today-synthesis — computeSiteTodaySynthesis (tally pur)', () => {
  it('compte séparément ouverts, réouverts, résolus récemment, questions MemorIA', () => {
    const points = [
      point({ id: 'a', derivedState: 'open' }),
      point({ id: 'b', derivedState: 'open' }),
      point({ id: 'c', derivedState: 'reopened' }),
      point({ id: 'd', derivedState: 'resolved', latestMeaningfulEventAt: '2026-09-05' }),
      point({ id: 'e', derivedState: 'resolved', latestMeaningfulEventAt: '2026-01-01' }), // trop ancien
    ]
    const result = computeSiteTodaySynthesis(points, 3, TODAY)
    expect(result).toEqual({
      totalPoints: 5,
      openPoints: 2,
      reopenedPoints: 1,
      resolvedRecently: 1,
      needsYouCount: 3,
      lastActivityAt: '2026-09-05',
    })
  })

  it('retient la dernière évolution la plus récente parmi tous les Points', () => {
    const points = [
      point({ id: 'a', derivedState: 'resolved', latestMeaningfulEventAt: '2026-08-01' }),
      point({ id: 'b', derivedState: 'open', latestMeaningfulEventAt: '2026-09-08' }),
    ]
    expect(computeSiteTodaySynthesis(points, 0, TODAY).lastActivityAt).toBe('2026-09-08')
  })

  it('population vide → zéros, aucune activité', () => {
    expect(computeSiteTodaySynthesis([], 0, TODAY)).toEqual({
      totalPoints: 0,
      openPoints: 0,
      reopenedPoints: 0,
      resolvedRecently: 0,
      needsYouCount: 0,
      lastActivityAt: null,
    })
  })
})
