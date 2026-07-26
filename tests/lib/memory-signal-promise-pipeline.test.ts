import { describe, expect, it } from 'vitest'

import type { StructuredPromiseRecord } from '@/lib/memory/signals/promise-candidates'
import { detectPromiseSignalsFromRecords } from '@/lib/memory/signals/promise-pipeline'

const source = {
  type: 'visit',
  id: 'report-1',
  href: '/sites/site-1/visites/report-1',
  label: 'Visite du 21 juillet',
}

const record = (overrides: Partial<StructuredPromiseRecord> = {}): StructuredPromiseRecord => ({
  id: 'promise-1',
  organizationId: 'org-1',
  siteId: 'site-1',
  kind: 'promise',
  title: 'Le planning sera diffuse vendredi.',
  body: null,
  source,
  subject: { table: 'captured_knowledge', id: 'promise-1', organizationId: 'org-1', siteId: 'site-1' },
  occurredAt: '2026-07-20T08:00:00+11:00',
  dueAt: null,
  confirmedAt: null,
  confirmationSourceIds: [],
  relatedProofSourceIds: [],
  importance: 'normal',
  blocking: false,
  ...overrides,
})

describe('detectPromiseSignalsFromRecords', () => {
  it('passe des records structures au builder, aux deux detecteurs et au runner', () => {
    const signals = detectPromiseSignalsFromRecords(
      [
        record({ id: 'expired', dueAt: '2026-07-25T23:59:59+11:00' }),
        record({ id: 'follow-up', dueAt: null, occurredAt: '2026-07-20T08:00:00+11:00' }),
      ],
      '2026-07-28T08:00:00+11:00',
    )

    expect(signals).toHaveLength(2)
    expect(signals.map((signal) => signal.trigger.reason).sort()).toEqual([
      'promise_expired',
      'promise_without_due_date',
    ])
  })
})
