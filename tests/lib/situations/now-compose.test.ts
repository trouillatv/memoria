import { describe, expect, it } from 'vitest'
import type { MemorySignal } from '@/lib/memory/signals/operational-contract'
import { composeNowCardsFromSignals } from '@/lib/situations/now/compose'

const signal: MemorySignal = {
  id: 'signal-1',
  organizationId: 'org-1',
  siteId: 'site-1',
  category: 'promise',
  trigger: { type: 'promise', reason: 'promise_expired' },
  severity: 'warning',
  importance: 'high',
  urgency: 'today',
  state: 'active',
  actionability: 'direct',
  origin: 'rules',
  facts: [],
  rules: [],
  sources: [{ type: 'visit', id: 'visit-1', href: '/visites/visit-1', label: 'Visite du 21 juillet' }],
  actions: [{ kind: 'open_source', label: 'Voir la source', href: '/visites/visit-1' }],
  confidence: null,
  dedupeKey: 'signal-1',
  detectedAt: '2026-07-25T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  resolvedBy: null,
}

describe('composeNowCardsFromSignals', () => {
  it('ne projette aucune promesse tant qu’aucune capability directe n’existe', () => {
    expect(composeNowCardsFromSignals([signal])).toEqual([])
  })
})
