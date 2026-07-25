import { describe, expect, it } from 'vitest'
import { detectPromiseSignals, type PromiseDetectionContext } from '@/lib/memory/signals/promise-detector'

const source = { type: 'visit', id: 'report-1', href: '/sites/site-1/visites/report-1', label: 'Visite du 21 juillet' }

const context = (overrides: Partial<PromiseDetectionContext> = {}): PromiseDetectionContext => ({
  promises: [{
    id: 'promise-1', organizationId: 'org-1', siteId: 'site-1',
    text: 'Le planning sera diffusé vendredi.', source, occurredAt: '2026-07-21T09:00:00.000Z', dueAt: '2026-07-25',
    confirmedAt: null, proofSourceIds: [],
  }],
  ...overrides,
})

describe('PromiseDetector', () => {
  it('produit un signal pour une promesse échue sans confirmation', () => {
    const [signal] = detectPromiseSignals(context(), '2026-07-28T08:00:00.000Z')

    expect(signal).toMatchObject({
      category: 'promise',
      trigger: { type: 'promise', reason: 'promise_expired' },
      origin: 'rules',
      actionability: 'investigate',
      confidence: null,
      dedupeKey: 'promise-expired:site-1:promise-1',
    })
    expect(signal.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'promise_text', value: 'Le planning sera diffusé vendredi.', dueAt: '2026-07-25', validUntil: null }),
    ]))
  })

  it('ignore une promesse future, sans date résolue ou déjà confirmée', () => {
    expect(detectPromiseSignals(context(), '2026-07-24T08:00:00.000Z')).toHaveLength(0)
    expect(detectPromiseSignals(context({ promises: [{ ...context().promises[0], dueAt: null }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
    expect(detectPromiseSignals(context({ promises: [{ ...context().promises[0], confirmedAt: '2026-07-26T08:00:00.000Z' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
  })

  it('ignore une promesse déjà couverte par une preuve plus récente', () => {
    const [promise] = context().promises
    expect(detectPromiseSignals(context({ promises: [{ ...promise, proofSourceIds: ['photo-1'] }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
  })
})
