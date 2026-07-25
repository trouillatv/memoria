import { describe, expect, it } from 'vitest'
import type { MemorySignal } from '@/lib/memory/signals/operational-contract'
import { presentSituation, presentSituations } from '@/lib/situations/presenter'

function baseSignal(overrides: Partial<MemorySignal> = {}): MemorySignal {
  return {
    id: 'signal-1',
    organizationId: 'org-1',
    siteId: 'site-1',
    category: 'promise',
    trigger: { type: 'promise', reason: 'promise_expired' },
    severity: 'warning',
    importance: 'high',
    urgency: 'today',
    state: 'active',
    actionability: 'investigate',
    origin: 'rules',
    facts: [
      {
        type: 'promise',
        key: 'promise_text',
        value: 'Le planning sera diffusé vendredi.',
        confidence: null,
        sourceIds: ['visit-1'],
        detectedAt: '2026-07-25T08:00:00.000Z',
        occurredAt: '2026-07-06T08:00:00.000Z',
        dueAt: '2026-07-06T08:00:00.000Z',
        validUntil: null,
      },
      {
        type: 'context',
        key: 'site_name',
        value: 'Lycée PETRO ATTITI',
        confidence: null,
        sourceIds: ['visit-1'],
        detectedAt: '2026-07-25T08:00:00.000Z',
        occurredAt: null,
        dueAt: null,
        validUntil: null,
      },
      {
        type: 'context',
        key: 'organization_name',
        value: 'Demo Org',
        confidence: null,
        sourceIds: ['visit-1'],
        detectedAt: '2026-07-25T08:00:00.000Z',
        occurredAt: null,
        dueAt: null,
        validUntil: null,
      },
    ],
    rules: [{ id: 'promise_expired', version: '1' }],
    sources: [{ type: 'visit', id: 'visit-1', href: '/visites/visit-1', label: 'Visite du 21 juillet' }],
    actions: [{ kind: 'investigate', label: 'Vérifier', href: '/visites/visit-1' }],
    confidence: null,
    dedupeKey: 'promise-expired:site-1:signal-1',
    detectedAt: '2026-07-25T08:00:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  }
}

describe('SituationPresenter', () => {
  it('mappe une promesse échue en situation métier lisible', () => {
    const before = structuredClone(baseSignal())

    const situation = presentSituation(baseSignal(), '2026-07-25T08:00:00.000Z')

    expect(situation).toEqual(expect.objectContaining({
      id: 'signal-1',
      signalId: 'signal-1',
      kind: 'expired_promise',
      severity: 'warning',
      title: expect.any(String),
      explanation: expect.any(String),
      site: expect.objectContaining({
        id: 'site-1',
        name: 'Lycée PETRO ATTITI',
        organizationId: 'org-1',
        organizationName: 'Demo Org',
      }),
      timing: expect.objectContaining({
        occurredAt: '2026-07-06T08:00:00.000Z',
        dueAt: '2026-07-06T08:00:00.000Z',
        detectedAt: '2026-07-25T08:00:00.000Z',
        ageDays: 19,
        label: expect.stringContaining('19'),
      }),
      source: expect.objectContaining({
        type: 'visit',
        id: 'visit-1',
        href: '/visites/visit-1',
        label: 'Visite du 21 juillet',
      }),
      capabilities: [
        { kind: 'open_source', label: 'Voir la source', href: '/visites/visit-1' },
      ],
    }))

    expect(situation?.title).toMatch(/(non tenue|échue|non diffusée|à confirmer)/i)
    expect(situation?.explanation).not.toMatch(/promise_expired/i)
    expect(baseSignal()).toEqual(before)
  })

  it('mappe une promesse sans date en annonce à confirmer sans vocabulaire de retard', () => {
    const signal = baseSignal({
      id: 'signal-2',
      trigger: { type: 'promise', reason: 'promise_without_due_date' },
      severity: 'info',
      urgency: 'today',
      facts: [
        {
          type: 'promise',
          key: 'promise_text',
          value: 'L’accès sécurisé sera communiqué sous peu.',
          confidence: null,
          sourceIds: ['visit-2'],
          detectedAt: '2026-07-25T08:00:00.000Z',
          occurredAt: '2026-07-10T08:00:00.000Z',
          dueAt: null,
          validUntil: null,
        },
      ],
      sources: [{ type: 'visit', id: 'visit-2', href: '/visites/visit-2', label: 'Réunion du 10 juillet' }],
    })

    const situation = presentSituation(signal, '2026-07-25T08:00:00.000Z')

    expect(situation).toEqual(expect.objectContaining({
      kind: 'unconfirmed_promise',
      title: expect.stringMatching(/annonce|confirmation/i),
      source: expect.objectContaining({
        id: 'visit-2',
        href: '/visites/visit-2',
      }),
    }))
    expect(situation?.timing.ageDays).toBe(15)
    expect(situation?.timing.label).toMatch(/15/)
    expect(`${situation?.title} ${situation?.explanation}`).not.toMatch(/retard|échue|échéance/i)
    expect(situation?.capabilities).toEqual([
      { kind: 'open_source', label: 'Voir la source', href: '/visites/visit-2' },
    ])
  })

  it('ignore proprement un signal non supporté', () => {
    const signal = baseSignal({
      id: 'signal-3',
      trigger: { type: 'question', reason: 'question_unanswered' },
    })

    expect(presentSituation(signal)).toBeNull()
    expect(presentSituations([signal])).toEqual([])
  })
})
