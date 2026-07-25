import { describe, expect, it } from 'vitest'
import { factActionId, factCanComplete, factDueAt, factPriority, factSiteName, factTitle } from '@/lib/memory/signals/fact-selectors'
import type { MemorySignal } from '@/lib/memory/signals/operational-contract'

const signal = (facts: MemorySignal['facts']): MemorySignal => ({
  id: 'signal-1', organizationId: 'org-1', siteId: 'site-1', category: 'priority',
  trigger: { type: 'old_action', reason: 'object_aging' }, severity: 'warning', importance: 'normal', urgency: 'today',
  state: 'active', actionability: 'direct', origin: 'rules', facts, rules: [], sources: [], actions: [], confidence: null,
  dedupeKey: 'signal-1', detectedAt: '2026-07-25T08:00:00.000Z', acknowledgedAt: null, resolvedAt: null, resolvedBy: null,
})

describe('sélecteurs canoniques de faits', () => {
  it('retourne les faits typés et null quand la clé ou le type manque', () => {
    const current = signal([
      { type: 'action', key: 'title', value: 'Contacter PAVE', confidence: null, sourceIds: [], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: '2026-07-25', validUntil: null },
      { type: 'dashboard_item', key: 'site_name', value: 'Ducos', confidence: null, sourceIds: [], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      { type: 'dashboard_item', key: 'action_id', value: 42, confidence: null, sourceIds: [], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      { type: 'dashboard_item', key: 'can_complete', value: true, confidence: null, sourceIds: [], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      { type: 'dashboard_item', key: 'priority', value: 'today', confidence: null, sourceIds: [], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
    ])

    expect(factTitle(current)).toBe('Contacter PAVE')
    expect(factSiteName(current)).toBe('Ducos')
    expect(factActionId(current)).toBeNull()
    expect(factCanComplete(current)).toBe(true)
    expect(factPriority(current)).toBe('today')
    expect(factDueAt(current)).toBe('2026-07-25')
  })

  it('ne transforme pas une valeur non textuelle en libellé métier', () => {
    const current = signal([
      { type: 'dashboard_item', key: 'site_name', value: 12, confidence: null, sourceIds: [], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
    ])
    expect(factSiteName(current)).toBeNull()
    expect(factTitle(current)).toBeNull()
  })
})
