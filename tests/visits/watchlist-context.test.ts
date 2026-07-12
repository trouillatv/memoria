// Profondeur du clic « À vérifier » — le pourquoi est daté, le geste est
// concret, la source garde son vrai type (réunion ≠ visite).

import { describe, it, expect } from 'vitest'
import { buildWatchContext } from '@/lib/visits/watchlist-context'

const NOW = new Date('2026-07-12T08:00:00Z').getTime()

describe('buildWatchContext', () => {
  it('réserve : pourquoi daté + localisation + geste de preuve', () => {
    const c = buildWatchContext(
      { source_kind: 'reserve_open', sinceIso: '2026-06-24T08:00:00Z', location: 'toiture' },
      NOW,
    )
    expect(c.why).toBe('Réserve ouverte — toiture depuis 18 j.')
    expect(c.gesture).toContain('photographier')
  })

  it('action en retard : ancienneté + échéance dépassée', () => {
    const c = buildWatchContext(
      { source_kind: 'action_overdue', sinceIso: '2026-07-02T08:00:00Z', dueIso: '2026-07-09' },
      NOW,
    )
    expect(c.why).toBe('Action ouverte depuis 10 j, échéance dépassée.')
  })

  it('la source garde son vrai type : une visite ne devient jamais une réunion', () => {
    const c = buildWatchContext(
      { source_kind: 'reserve_open', source: { kind: 'visite', id: 'v1', dateLabel: '10 juillet' } },
      NOW,
    )
    expect(c.sourceLabel).toBe('Vu en visite du 10 juillet')
    expect(c.sourceHref).toBe('/m/visite/v1/recap')
  })

  it('réunion source → route réunion', () => {
    const c = buildWatchContext(
      { source_kind: 'decision_unapplied', source: { kind: 'reunion', id: 'r1', dateLabel: '5 juillet' } },
      NOW,
    )
    expect(c.sourceHref).toBe('/m/reunion/r1')
  })

  it('point manuel : aucune source inventée', () => {
    const c = buildWatchContext({ source_kind: 'manual' }, NOW)
    expect(c.sourceLabel).toBeNull()
    expect(c.sourceHref).toBeNull()
    expect(c.why).toContain('Ajouté à la main')
  })
})
