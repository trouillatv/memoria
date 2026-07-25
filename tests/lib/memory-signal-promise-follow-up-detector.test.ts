import { describe, expect, it } from 'vitest'
import { detectPromiseNeedsConfirmationSignals, type PromiseDetectionContext } from '@/lib/memory/signals/promise-follow-up-detector'

const source = { type: 'visit' as const, id: 'report-1', href: '/sites/site-1/visites/report-1', label: 'Visite du 21 juillet' }

const context = (overrides: Partial<PromiseDetectionContext> = {}): PromiseDetectionContext => ({
  promises: [{
    id: 'promise-1', organizationId: 'org-1', siteId: 'site-1',
    text: 'Le planning sera diffusé prochainement.', source, occurredAt: '2026-07-21T09:00:00.000Z', dueAt: null,
    confirmedAt: null, confirmationSourceIds: [], relatedProofSourceIds: [], replacedAt: null, cancelledAt: null, importance: 'normal', blocking: false,
  }],
  ...overrides,
})

describe('PromiseNeedsConfirmationDetector', () => {
  it('produit une annonce à confirmer pour une promesse ancienne sans échéance', () => {
    const [signal] = detectPromiseNeedsConfirmationSignals(context(), '2026-07-29T08:00:00.000Z')

    expect(signal).toMatchObject({
      category: 'promise',
      trigger: { type: 'promise', reason: 'promise_without_due_date' },
      origin: 'rules',
      actionability: 'investigate',
      confidence: null,
      dedupeKey: 'promise-follow-up:site-1:promise-1',
      importance: 'normal',
      severity: 'warning',
      urgency: 'today',
    })
    expect(signal.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'investigate', label: 'Confirmer' }),
    ]))
    expect(signal.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'promise_text', value: 'Le planning sera diffusé prochainement.', dueAt: null }),
    ]))
    expect(signal.explanation ?? '').not.toMatch(/retard|échéance dépassée|en retard|délai dépassé/i)
  })

  it('ne produit aucun signal si la promesse est trop récente', () => {
    expect(detectPromiseNeedsConfirmationSignals(context({ promises: [{ ...context().promises[0], occurredAt: '2026-07-24T09:00:00.000Z' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
  })

  it('ignore une confirmation, un remplacement ou une annulation', () => {
    const promise = context().promises[0]
    expect(detectPromiseNeedsConfirmationSignals(context({ promises: [{ ...promise, confirmedAt: '2026-07-26T00:00:00.000Z' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
    expect(detectPromiseNeedsConfirmationSignals(context({ promises: [{ ...promise, replacedAt: '2026-07-26T00:00:00.000Z' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
    expect(detectPromiseNeedsConfirmationSignals(context({ promises: [{ ...promise, cancelledAt: '2026-07-26T00:00:00.000Z' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
  })

  it('ne produit jamais un suivi en plus du signal expiré pour un candidat daté', () => {
    expect(detectPromiseNeedsConfirmationSignals(context({ promises: [{ ...context().promises[0], dueAt: '2026-07-25T23:59:59+11:00' }] }), '2026-07-28T08:00:00.000Z')).toHaveLength(0)
  })

  it('conserve importance et blocking', () => {
    const [signal] = detectPromiseNeedsConfirmationSignals(context({ promises: [{ ...context().promises[0], importance: 'high', blocking: true }] }), '2026-07-29T08:00:00.000Z')
    expect(signal).toMatchObject({ importance: 'high', severity: 'critical', urgency: 'now' })
  })
})
