import { describe, expect, it } from 'vitest'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import type { WatchlistEntry } from './pv-watchlist'
import type { ImportantSubject } from './site-synthesis'
import {
  computeNativeWatchlist,
  computeNativeImportantSubjects,
  computeUnifiedWatchlist,
  computeUnifiedImportantSubjects,
} from './native-synthesis'

function makeSubject(overrides: Partial<NavigableSubjectSummary> & { canonicalSubjectId: string }): NavigableSubjectSummary {
  return {
    title: overrides.canonicalSubjectId,
    aliases: [],
    durableKind: 'business_subject',
    dominantFamily: null,
    currentStatus: null,
    firstSeenAt: null,
    lastSeenAt: null,
    lastMeaningfulChangeAt: null,
    pvCount: 0,
    threadCount: 0,
    nativeOccurrenceCount: 0,
    activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 },
    isStagnant: false,
    stagnationDays: 0,
    consecutiveMentionsWithoutChange: 0,
    terrainObjects: [],
    currentTriState: 'unknown',
    displayState: 'open',
    provenOpen: false,
    activeObjectsCboAware: 0,
    presentInLastPv: false,
    pvSinceLastMention: 0,
    ...overrides,
  }
}

function makeWatchlistEntry(overrides: Partial<WatchlistEntry> & { canonicalSubjectId: string }): WatchlistEntry {
  return {
    subjectThreadId: overrides.canonicalSubjectId,
    label: overrides.canonicalSubjectId,
    thematicCategory: null,
    family: 'unknown',
    reason: 'sans_évolution',
    pvCount: 1,
    totalRuns: 1,
    lastRunIndex: 0,
    ...overrides,
  }
}

function makeImportantSubject(overrides: Partial<ImportantSubject> & { canonicalSubjectId: string }): ImportantSubject {
  return {
    label: overrides.canonicalSubjectId,
    pvCount: 1,
    openActions: 0,
    openReserves: 0,
    activeDeadlines: 0,
    overdueDeadlines: 0,
    reappearance: false,
    recentOccurrence: false,
    score: 10,
    ...overrides,
  }
}

describe('computeUnifiedWatchlist — P0-2 Suivi unifié (4 cas Vincent)', () => {
  it('cas 1 — historique seul : rendu inchangé', () => {
    const subjects = [
      makeSubject({ canonicalSubjectId: 'cs1', nativeOccurrenceCount: 0 }),
      makeSubject({ canonicalSubjectId: 'cs2', nativeOccurrenceCount: 0 }),
    ]
    const pvWatchlist = [
      makeWatchlistEntry({ canonicalSubjectId: 'cs1', reason: 'non_conforme', pvCount: 3, totalRuns: 5, lastRunIndex: 4 }),
      makeWatchlistEntry({ canonicalSubjectId: 'cs2', reason: 'sans_évolution', pvCount: 2, totalRuns: 5, lastRunIndex: 2 }),
    ]
    const result = computeUnifiedWatchlist(subjects, pvWatchlist, ['d0', 'd1', 'd2', 'd3', 'd4'], {})
    expect(result).toEqual(pvWatchlist)
  })

  it('cas 2 — natif seul : rendu identique à computeNativeWatchlist', () => {
    const subjects = [
      makeSubject({ canonicalSubjectId: 'n1', nativeOccurrenceCount: 2, isStagnant: true }),
      makeSubject({ canonicalSubjectId: 'n2', nativeOccurrenceCount: 1, displayState: 'reopened' }),
      makeSubject({ canonicalSubjectId: 'n3', nativeOccurrenceCount: 1, durableKind: 'actor', displayState: 'reopened' }),
    ]
    const unified = computeUnifiedWatchlist(subjects, [], [], {})
    expect(unified).toEqual(computeNativeWatchlist(subjects))
  })

  it('cas 3 — mixte avec sujet natif inédit : le sujet apparaît', () => {
    const subjects = [
      makeSubject({ canonicalSubjectId: 'h1', nativeOccurrenceCount: 0 }),
      makeSubject({ canonicalSubjectId: 'n-new', nativeOccurrenceCount: 3, isStagnant: true }),
    ]
    const pvWatchlist = [
      makeWatchlistEntry({ canonicalSubjectId: 'h1', reason: 'sans_évolution', pvCount: 4, totalRuns: 5, lastRunIndex: 4 }),
    ]
    const result = computeUnifiedWatchlist(subjects, pvWatchlist, ['d0'], {})
    const appeared = result.find((w) => w.canonicalSubjectId === 'n-new')
    expect(appeared).toBeDefined()
    expect(appeared?.reason).toBe('sans_évolution')
    expect(appeared?.pvCount).toBe(3)
    expect(result.find((w) => w.canonicalSubjectId === 'h1')).toEqual(pvWatchlist[0])
  })

  it('cas 4 — mixte, sujet historique + signal natif plus récent : le signal natif n\'est pas perdu', () => {
    const subjects = [
      makeSubject({ canonicalSubjectId: 'mixed1', nativeOccurrenceCount: 1, isStagnant: true }),
    ]
    const pvWatchlist = [
      makeWatchlistEntry({ canonicalSubjectId: 'mixed1', reason: 'aggravé', pvCount: 4, totalRuns: 2, lastRunIndex: 1 }),
    ]
    const matrixRunDates = ['2026-01-01', '2026-03-01']
    const nativeOccurrences = { mixed1: [{ date: '2026-04-01', sourceKind: 'field_visit' as const }] }

    const result = computeUnifiedWatchlist(subjects, pvWatchlist, matrixRunDates, nativeOccurrences)
    const entry = result.find((w) => w.canonicalSubjectId === 'mixed1')
    expect(entry).toBeDefined()
    // 'aggravé' est périmé (occurrence native postérieure au run source) : retombe sur le signal natif, jamais perdu.
    expect(entry?.reason).toBe('sans_évolution')
    expect(entry?.pvCount).toBe(5)
  })

  it('cas 4bis — signal aggravé encore frais (aucune occurrence native postérieure au run) : conservé', () => {
    const subjects = [
      makeSubject({ canonicalSubjectId: 'mixed2', nativeOccurrenceCount: 1, isStagnant: true }),
    ]
    const pvWatchlist = [
      makeWatchlistEntry({ canonicalSubjectId: 'mixed2', reason: 'aggravé', pvCount: 4, totalRuns: 2, lastRunIndex: 1 }),
    ]
    const matrixRunDates = ['2026-01-01', '2026-03-01']
    const nativeOccurrences = { mixed2: [{ date: '2026-02-01', sourceKind: 'field_visit' as const }] }

    const result = computeUnifiedWatchlist(subjects, pvWatchlist, matrixRunDates, nativeOccurrences)
    const entry = result.find((w) => w.canonicalSubjectId === 'mixed2')
    expect(entry?.reason).toBe('aggravé')
    expect(entry?.pvCount).toBe(5)
  })
})

describe('computeUnifiedImportantSubjects — P0-2 Suivi unifié (4 cas Vincent)', () => {
  it('cas 1 — historique seul : rendu inchangé', () => {
    const subjects = [
      makeSubject({ canonicalSubjectId: 'cs1', nativeOccurrenceCount: 0 }),
    ]
    const historicalImportant = [makeImportantSubject({ canonicalSubjectId: 'cs1', score: 20 })]
    const result = computeUnifiedImportantSubjects(subjects, historicalImportant)
    expect(result).toEqual(historicalImportant)
  })

  it('cas 2 — natif seul : rendu identique à computeNativeImportantSubjects', () => {
    const subjects = [
      makeSubject({
        canonicalSubjectId: 'n1',
        nativeOccurrenceCount: 2,
        isStagnant: true,
        activeObjects: { actionsOpen: 1, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 1 },
      }),
    ]
    const unified = computeUnifiedImportantSubjects(subjects, [])
    expect(unified).toEqual(computeNativeImportantSubjects(subjects))
  })

  it('cas 3 — mixte avec sujet natif inédit : le sujet apparaît', () => {
    const subjects = [
      makeSubject({ canonicalSubjectId: 'h1', nativeOccurrenceCount: 0 }),
      makeSubject({
        canonicalSubjectId: 'n-new',
        nativeOccurrenceCount: 2,
        activeObjects: { actionsOpen: 2, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 2 },
      }),
    ]
    const historicalImportant = [makeImportantSubject({ canonicalSubjectId: 'h1', score: 15 })]
    const result = computeUnifiedImportantSubjects(subjects, historicalImportant)
    expect(result.find((s) => s.canonicalSubjectId === 'n-new')).toBeDefined()
    expect(result.find((s) => s.canonicalSubjectId === 'h1')).toEqual(historicalImportant[0])
  })

  it('cas 4 — mixte, sujet historique + activité native : objets actifs rafraîchis, signal non perdu', () => {
    const subjects = [
      makeSubject({
        canonicalSubjectId: 'mixed1',
        nativeOccurrenceCount: 2,
        displayState: 'reopened',
        activeObjects: { actionsOpen: 3, reservesOpen: 1, deadlinesActive: 0, decisionsOpen: 0, total: 4 },
      }),
    ]
    const historicalImportant = [
      makeImportantSubject({ canonicalSubjectId: 'mixed1', pvCount: 4, openActions: 1, reappearance: false, score: 10 }),
    ]
    const result = computeUnifiedImportantSubjects(subjects, historicalImportant)
    const entry = result.find((s) => s.canonicalSubjectId === 'mixed1')
    expect(entry?.pvCount).toBe(6)
    expect(entry?.openActions).toBe(3)
    expect(entry?.reappearance).toBe(true)
  })
})
