// Anticipation des promesses (promise_expiring_soon) — règle par DATE CIVILE
// Nouméa : échéance aujourd'hui ou demain, non dépassée. Jamais en double avec
// promise_expired (frontière : l'instant `now`).

import { describe, expect, it } from 'vitest'
import { detectPromiseExpiringSoonSignals } from '@/lib/memory/signals/promise-upcoming-detector'
import { detectPromiseSignalsFromRecords } from '@/lib/memory/signals/promise-pipeline'
import type { PromiseDetectionContext } from '@/lib/memory/signals/promise-detector'
import type { StructuredPromiseRecord } from '@/lib/memory/signals/promise-candidates'

// 2026-07-28T08:00Z = 2026-07-28 19:00 à Nouméa → aujourd'hui local = 28, demain = 29.
const NOW = '2026-07-28T08:00:00.000Z'
const source = { type: 'visit' as const, id: 'report-1', href: '/sites/site-1/visites/report-1', label: 'Visite' }

const context = (dueAt: string | null, over: Record<string, unknown> = {}): PromiseDetectionContext => ({
  promises: [{
    id: 'promise-1', organizationId: 'org-1', siteId: 'site-1', siteName: 'Lycée PETRO ATTITI',
    subject: { table: 'captured_knowledge', id: 'promise-1', organizationId: 'org-1', siteId: 'site-1' },
    text: 'Le planning sera diffusé vendredi.', source, occurredAt: '2026-07-21T09:00:00.000Z', dueAt,
    confirmedAt: null, confirmationSourceIds: [], relatedProofSourceIds: [],
    replacedAt: null, cancelledAt: null, importance: 'normal', blocking: false, ...over,
  }],
})

describe('PromiseExpiringSoonDetector — frontières civiles Nouméa', () => {
  it('échéance DEMAIN (civil Nouméa) → signal À anticiper, warning, urgency week', () => {
    const [signal] = detectPromiseExpiringSoonSignals(context('2026-07-29T23:59:59+11:00'), NOW)
    expect(signal).toMatchObject({
      trigger: { type: 'promise', reason: 'promise_expiring_soon' },
      severity: 'warning',
      urgency: 'week',
      dedupeKey: 'promise-upcoming:site-1:promise-1',
    })
    expect(signal.subject).toEqual({ table: 'captured_knowledge', id: 'promise-1', organizationId: 'org-1', siteId: 'site-1' })
  })

  it("échéance AUJOURD'HUI pas encore passée → signal, urgency today", () => {
    const [signal] = detectPromiseExpiringSoonSignals(context('2026-07-28T23:00:00+11:00'), NOW)
    expect(signal).toMatchObject({ urgency: 'today' })
  })

  it('échéance APRÈS-DEMAIN → aucun signal (hors horizon)', () => {
    expect(detectPromiseExpiringSoonSignals(context('2026-07-30T09:00:00+11:00'), NOW)).toHaveLength(0)
  })

  it('échéance DÉPASSÉE → aucun signal (territoire de promise_expired)', () => {
    expect(detectPromiseExpiringSoonSignals(context('2026-07-28T18:00:00+11:00'), NOW)).toHaveLength(0)
  })

  it('sans échéance, confirmée, remplacée ou annulée → aucun signal', () => {
    expect(detectPromiseExpiringSoonSignals(context(null), NOW)).toHaveLength(0)
    expect(detectPromiseExpiringSoonSignals(context('2026-07-29T09:00:00+11:00', { confirmedAt: '2026-07-27T00:00:00Z' }), NOW)).toHaveLength(0)
    expect(detectPromiseExpiringSoonSignals(context('2026-07-29T09:00:00+11:00', { replacedAt: '2026-07-27T00:00:00Z' }), NOW)).toHaveLength(0)
    expect(detectPromiseExpiringSoonSignals(context('2026-07-29T09:00:00+11:00', { cancelledAt: '2026-07-27T00:00:00Z' }), NOW)).toHaveLength(0)
  })

  it('bloquante → critical/now uniquement dans ce cas (doctrine « critique » réservé au grave)', () => {
    const [signal] = detectPromiseExpiringSoonSignals(context('2026-07-29T09:00:00+11:00', { blocking: true }), NOW)
    expect(signal.severity).toBe('critical')
  })
})

describe('Pipeline — jamais deux signaux pour la même promesse', () => {
  const record = (dueAt: string | null): StructuredPromiseRecord => ({
    id: 'p-1', organizationId: 'org-1', siteId: 'site-1', siteName: 'Lycée PETRO ATTITI', kind: 'promise',
    title: 'Le planning sera diffusé vendredi.', body: null, source,
    subject: { table: 'captured_knowledge', id: 'p-1', organizationId: 'org-1', siteId: 'site-1' },
    occurredAt: '2026-07-21T09:00:00.000Z', dueAt,
    confirmedAt: null, confirmationSourceIds: [], relatedProofSourceIds: [], importance: 'normal', blocking: false,
  })

  it('dépassée → promise_expired seul', () => {
    const signals = detectPromiseSignalsFromRecords([record('2026-07-25T23:59:59+11:00')], NOW)
    expect(signals.map((s) => s.trigger.reason)).toEqual(['promise_expired'])
  })

  it('due demain → promise_expiring_soon seul', () => {
    const signals = detectPromiseSignalsFromRecords([record('2026-07-29T23:59:59+11:00')], NOW)
    expect(signals.map((s) => s.trigger.reason)).toEqual(['promise_expiring_soon'])
  })
})
