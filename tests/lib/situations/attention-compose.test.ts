import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { MemorySignal } from '@/lib/memory/signals/operational-contract'
import { composeAttentionCardsFromSignals } from '@/lib/situations/attention/compose'

function signal(overrides: Partial<MemorySignal> = {}): MemorySignal {
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
      { type: 'promise', key: 'promise_text', value: 'Le planning sera diffusé vendredi.', confidence: null, sourceIds: ['visit-1'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: '2026-07-06T08:00:00.000Z', dueAt: '2026-07-06T08:00:00.000Z', validUntil: null },
      { type: 'context', key: 'site_name', value: 'Lycée PETRO ATTITI', confidence: null, sourceIds: ['visit-1'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      { type: 'context', key: 'organization_name', value: 'Demo Org', confidence: null, sourceIds: ['visit-1'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
    ],
    rules: [{ id: 'promise_expired', version: '1' }],
    sources: [{ type: 'visit', id: 'visit-1', href: '/visites/visit-1', label: 'Visite du 21 juillet' }],
    actions: [{ kind: 'investigate', label: 'Voir la source', href: '/visites/visit-1' }],
    confidence: null,
    dedupeKey: 'promise-expired:site-1:signal-1',
    detectedAt: '2026-07-25T08:00:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  }
}

describe('composeAttentionCardsFromSignals', () => {
  it('compose deux cartes de promesse à partir de MemorySignal', () => {
    const input = [
      signal(),
      signal({
        id: 'signal-2',
        trigger: { type: 'promise', reason: 'promise_without_due_date' },
        severity: 'info',
        facts: [
          { type: 'promise', key: 'promise_text', value: 'L’accès sécurisé sera communiqué sous peu.', confidence: null, sourceIds: ['visit-2'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: '2026-07-10T08:00:00.000Z', dueAt: null, validUntil: null },
          { type: 'context', key: 'site_name', value: 'CAFAT Centre-ville', confidence: null, sourceIds: ['visit-2'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
        ],
        sources: [{ type: 'visit', id: 'visit-2', href: '/visites/visit-2', label: 'Réunion du 10 juillet' }],
      }),
      signal({
        id: 'signal-3',
        trigger: { type: 'question', reason: 'question_unanswered' },
        category: 'question',
      }),
    ]
    const snapshot = structuredClone(input)

    const cards = composeAttentionCardsFromSignals(input)

    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({
      id: 'signal-1',
      title: 'Promesse non tenue',
      siteLabel: 'Lycée PETRO ATTITI',
      sourceLabel: 'Visite du 21 juillet',
    })
    expect(cards[1]).toMatchObject({
      id: 'signal-2',
      title: 'Annonce à confirmer',
      siteLabel: 'CAFAT Centre-ville',
    })
    expect(cards[1].organizationLabel).toBeUndefined()
    expect(cards[1].sourceLabel).toBe('Réunion du 10 juillet')
    expect(input).toEqual(snapshot)
  })

  it('ignore les signaux non supportés proprement', () => {
    const cards = composeAttentionCardsFromSignals([
      signal({ id: 'signal-x', trigger: { type: 'question', reason: 'question_unanswered' }, category: 'question' }),
    ])
    expect(cards).toEqual([])
  })

  it('ne dépend pas des propriétés techniques du signal dans ce fichier de composition', () => {
    const source = readFileSync('lib/situations/attention/compose.ts', 'utf8')
    expect(source).not.toMatch(/facts|trigger|category|reason/)
  })
})
