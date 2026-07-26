import { describe, expect, it } from 'vitest'
import { presentNowSignals } from '@/lib/memory/signals/surface-presenters'
import type { MemorySignal } from '@/lib/memory/signals/operational-contract'

const base = (overrides: Partial<MemorySignal> = {}): MemorySignal => ({
  id: 'signal-1',
  organizationId: 'org-1',
  siteId: 'site-1',
  category: 'priority',
  trigger: { type: 'old_action', reason: 'object_aging' },
  severity: 'warning',
  importance: 'high',
  urgency: 'today',
  state: 'active',
  actionability: 'direct',
  origin: 'rules',
  facts: [],
  rules: [],
  sources: [{ type: 'action', id: 'action-1', href: '/sites/site-1/actions', label: 'Contacter PAVE' }],
  actions: [{ kind: 'complete', label: 'Traiter', href: '/sites/site-1/actions' }],
  confidence: null,
  dedupeKey: 'signal-1',
  detectedAt: '2026-07-25T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  resolvedBy: null,
  ...overrides,
})

describe('presenters des surfaces MemorySignal', () => {
  it('reproduit une priorité Cockpit avec son type et ses dates', () => {
    const signal = base({
      facts: [
        { type: 'action', key: 'title', value: 'Contacter PAVE', confidence: null, sourceIds: ['action-1'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: '2026-07-25', validUntil: null },
        { type: 'dashboard_item', key: 'source_type', value: 'action', confidence: null, sourceIds: ['action-1'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
        { type: 'dashboard_item', key: 'site_name', value: 'Ducos', confidence: null, sourceIds: ['site-1'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
        { type: 'dashboard_item', key: 'priority', value: 'today', confidence: null, sourceIds: ['action-1'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
        { type: 'dashboard_item', key: 'action_id', value: 'action-1', confidence: null, sourceIds: ['action-1'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      ],
    })

    expect(presentNowSignals([signal], {})).toEqual([expect.objectContaining({
      id: 'signal-1',
      sourceType: 'action',
      title: 'Contacter PAVE',
      siteId: 'site-1',
      siteName: 'Ducos',
      dueDate: '2026-07-25',
      priority: 'today',
      actionId: 'action-1',
    })])
  })
})
