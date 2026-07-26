// T2 — PromiseSubjectRef traverse la chaîne SANS être confondu avec la source.
// `subject` (objet persistant à muter, autorité de T3) et `source` (preuve
// consultable) sont deux références distinctes : une promesse peut venir de
// captured_knowledge ou de site_knowledge_proposals, et la Situation doit porter
// la bonne table jusqu'au bout — sans jamais l'afficher.

import { describe, expect, it } from 'vitest'
import type { StructuredPromiseRecord } from '@/lib/memory/signals/promise-candidates'
import type { PromiseSubjectRef } from '@/lib/memory/signals/operational-contract'
import { detectPromiseSignalsFromRecords } from '@/lib/memory/signals/promise-pipeline'
import { presentSituation } from '@/lib/situations/presenter'

const NOW = '2026-07-28T08:00:00.000Z'
const source = { type: 'visit', id: 'report-1', href: '/sites/site-1/visites/report-1', label: 'Visite' }

function record(subject: PromiseSubjectRef, over: Partial<StructuredPromiseRecord> = {}): StructuredPromiseRecord {
  return {
    id: subject.id, organizationId: 'org-1', siteId: 'site-1', kind: 'promise',
    title: 'Le planning sera diffusé vendredi.', body: null, source, subject,
    occurredAt: '2026-07-21T09:00:00.000Z', dueAt: '2026-07-25T23:59:59+11:00',
    confirmedAt: null, confirmationSourceIds: [], relatedProofSourceIds: [],
    importance: 'normal', blocking: false, ...over,
  }
}

describe('T2 — PromiseSubjectRef : record → signal → Situation', () => {
  it('promesse échue issue de captured_knowledge : subject intact sur la Situation', () => {
    const subject: PromiseSubjectRef = { table: 'captured_knowledge', id: 'p-cap', organizationId: 'org-1', siteId: 'site-1' }
    const [signal] = detectPromiseSignalsFromRecords([record(subject)], NOW)
    expect(signal.subject).toEqual(subject)

    const situation = presentSituation(signal, NOW)
    expect(situation?.subject).toEqual(subject)
    // JAMAIS confondu avec la preuve consultable.
    expect(situation?.source?.id).toBe('report-1')
    expect(situation?.subject).not.toEqual(situation?.source)
  })

  it('promesse issue de site_knowledge_proposals : la bonne table est portée', () => {
    const subject: PromiseSubjectRef = { table: 'site_knowledge_proposals', id: 'p-prop', organizationId: 'org-1', siteId: 'site-1' }
    const [signal] = detectPromiseSignalsFromRecords([record(subject)], NOW)
    const situation = presentSituation(signal, NOW)
    expect(situation?.subject?.table).toBe('site_knowledge_proposals')
    expect(situation?.subject?.id).toBe('p-prop')
  })

  it('promesse SANS échéance (follow-up) porte aussi le subject jusqu\'à la Situation', () => {
    const subject: PromiseSubjectRef = { table: 'captured_knowledge', id: 'p-fu', organizationId: 'org-1', siteId: 'site-1' }
    const [signal] = detectPromiseSignalsFromRecords(
      [record(subject, { dueAt: null, occurredAt: '2026-07-01T08:00:00+11:00' })], NOW,
    )
    expect(signal.trigger.reason).toBe('promise_without_due_date')
    const situation = presentSituation(signal, NOW)
    expect(situation?.subject).toEqual(subject)
  })
})
