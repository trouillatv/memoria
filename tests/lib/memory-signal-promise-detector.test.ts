import { describe, expect, it } from 'vitest'
import { detectPromiseExpiredSignals, detectPromiseSignals, type PromiseDetectionContext } from '@/lib/memory/signals/promise-detector'

const source = { type: 'visit', id: 'report-1', href: '/sites/site-1/visites/report-1', label: 'Visite du 21 juillet' }

const context = (overrides: Partial<PromiseDetectionContext> = {}): PromiseDetectionContext => ({
  promises: [{
    id: 'promise-1', organizationId: 'org-1', siteId: 'site-1',
    text: 'Le planning sera diffusé vendredi.', source, occurredAt: '2026-07-21T09:00:00.000Z', dueAt: '2026-07-25T23:59:59+11:00',
    confirmedAt: null, confirmationSourceIds: [], relatedProofSourceIds: [], replacedAt: null, cancelledAt: null, importance: 'normal', blocking: false,
  }],
  ...overrides,
})

describe('PromiseExpiredDetector', () => {
  it('produit un signal pour une promesse échue sans confirmation', () => {
    const [signal] = detectPromiseExpiredSignals(context(), '2026-07-28T08:00:00.000Z')

    expect(signal).toMatchObject({
      category: 'promise',
      trigger: { type: 'promise', reason: 'promise_expired' },
      origin: 'rules',
      actionability: 'investigate',
      confidence: null,
      dedupeKey: 'promise-expired:site-1:promise-1',
      importance: 'normal',
      severity: 'warning',
    })
    expect(signal.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'promise_text', value: 'Le planning sera diffusé vendredi.', dueAt: '2026-07-25T23:59:59+11:00', validUntil: null }),
    ]))
  })

  it('ignore une promesse future, sans date résolue ou déjà confirmée', () => {
    expect(detectPromiseSignals(context(), '2026-07-25T08:00:00+11:00')).toHaveLength(0)
    expect(detectPromiseSignals(context({ promises: [{ ...context().promises[0], dueAt: '2026-07-25' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
    expect(detectPromiseSignals(context({ promises: [{ ...context().promises[0], dueAt: '2026-07-25T23:59:59.000' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
    expect(detectPromiseSignals(context({ promises: [{ ...context().promises[0], confirmedAt: '2026-07-26T08:00:00.000Z' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
  })

  it('ignore une promesse explicitement confirmée, mais pas une preuve seulement liée', () => {
    const [promise] = context().promises
    expect(detectPromiseSignals(context({ promises: [{ ...promise, relatedProofSourceIds: ['photo-1'] }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(1)
    expect(detectPromiseSignals(context({ promises: [{ ...promise, confirmationSourceIds: ['photo-1'] }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
  })

  it('conserve l’importance métier et respecte blocking', () => {
    const [signal] = detectPromiseSignals(context({ promises: [{ ...context().promises[0], importance: 'high', blocking: true }] }), '2026-07-26T00:00:01+11:00')
    expect(signal).toMatchObject({ importance: 'high', severity: 'critical', urgency: 'now' })
  })

  it('ignore une promesse remplacée ou annulée', () => {
    const promise = context().promises[0]

    expect(detectPromiseSignals(context({ promises: [{ ...promise, replacedAt: '2026-07-26T00:00:00.000Z' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
    expect(detectPromiseSignals(context({ promises: [{ ...promise, cancelledAt: '2026-07-26T00:00:00.000Z' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
  })

  it('conserve le wrapper historique avec le mÃªme rÃ©sultat', () => {
    expect(detectPromiseSignals(context(), '2026-07-28T08:00:00.000Z')).toEqual(
      detectPromiseExpiredSignals(context(), '2026-07-28T08:00:00.000Z'),
    )
  })
})
