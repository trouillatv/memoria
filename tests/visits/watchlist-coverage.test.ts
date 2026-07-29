// Tests de computeWatchlistCoverage (Sprint 3A).
// Fonction pure : pas de dépendance serveur, tests unitaires seuls suffisent.

import { describe, it, expect } from 'vitest'
import { computeWatchlistCoverage, type WatchlistCoverage } from '@/lib/visits/watchlist-coverage'
import type { WatchlistItemPriority, WatchlistItemState } from '@/types/db'

function item(state: WatchlistItemState, priority: WatchlistItemPriority = 'normal') {
  return { state, priority }
}

describe('computeWatchlistCoverage', () => {
  it('liste vide — completionRate = 1, isComplete = true (pas de division par zero)', () => {
    const c = computeWatchlistCoverage([])
    expect(c).toEqual<WatchlistCoverage>({
      total: 0, checked: 0, stillOpen: 0, notApplicable: 0,
      pending: 0, criticalPending: 0, importantPending: 0,
      completionRate: 1, isComplete: true,
    })
  })

  it('tous conformes — completionRate = 1, isComplete = true', () => {
    const c = computeWatchlistCoverage([item('checked'), item('checked'), item('checked')])
    expect(c.total).toBe(3)
    expect(c.checked).toBe(3)
    expect(c.pending).toBe(0)
    expect(c.completionRate).toBe(1)
    expect(c.isComplete).toBe(true)
  })

  it('melange des quatre etats', () => {
    const items = [
      item('checked'),
      item('still_open'),
      item('not_applicable'),
      item('pending'),
    ]
    const c = computeWatchlistCoverage(items)
    expect(c.total).toBe(4)
    expect(c.checked).toBe(1)
    expect(c.stillOpen).toBe(1)
    expect(c.notApplicable).toBe(1)
    expect(c.pending).toBe(1)
    expect(c.completionRate).toBe(0.75)
    expect(c.isComplete).toBe(false)
  })

  it('point critique en attente — criticalPending > 0', () => {
    const c = computeWatchlistCoverage([
      item('pending', 'critical'),
      item('checked', 'normal'),
    ])
    expect(c.criticalPending).toBe(1)
    expect(c.importantPending).toBe(0)
    expect(c.pending).toBe(1)
    expect(c.isComplete).toBe(false)
  })

  it('point important en attente — importantPending > 0', () => {
    const c = computeWatchlistCoverage([
      item('pending', 'important'),
      item('checked', 'critical'),
    ])
    expect(c.importantPending).toBe(1)
    expect(c.criticalPending).toBe(0)
  })

  it('not_applicable compte comme traite (completionRate inclus)', () => {
    const c = computeWatchlistCoverage([item('not_applicable'), item('not_applicable')])
    expect(c.notApplicable).toBe(2)
    expect(c.pending).toBe(0)
    expect(c.completionRate).toBe(1)
    expect(c.isComplete).toBe(true)
  })

  it('still_open compte comme traite mais non resolu', () => {
    const c = computeWatchlistCoverage([item('still_open'), item('still_open')])
    expect(c.stillOpen).toBe(2)
    expect(c.pending).toBe(0)
    expect(c.completionRate).toBe(1)
    expect(c.isComplete).toBe(true)
  })

  it('completionRate exact sur 7 points (dont 2 pending)', () => {
    const items = [
      item('checked'), item('checked'), item('checked'), item('checked'),
      item('still_open'), item('not_applicable'),
      item('pending'),
    ]
    const c = computeWatchlistCoverage(items)
    expect(c.total).toBe(7)
    expect(c.pending).toBe(1)
    expect(c.completionRate).toBeCloseTo(6 / 7)
    expect(c.isComplete).toBe(false)
  })
})
