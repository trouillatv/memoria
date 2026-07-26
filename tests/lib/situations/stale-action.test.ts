// Migration « action ancienne » : le signal staleness/old_action (déjà produit
// par lot1-adapters) traverse maintenant Situation → AttentionCard, au lieu de
// l'AttentionRow legacy. On vérifie les trois couches, avec les MÊMES faits
// (what/why/where) que le digest legacy — aucun enrichissement à la source.

import { describe, expect, it } from 'vitest'
import type { MemorySignal } from '@/lib/memory/signals/operational-contract'
import { presentSituation } from '@/lib/situations/presenter'
import { projectSituationForAttention } from '@/lib/situations/attention/project'
import { composeAttentionCardsFromSignals } from '@/lib/situations/attention/compose'

function staleActionSignal(overrides: Partial<MemorySignal> = {}): MemorySignal {
  const detectedAt = '2026-07-25T08:00:00.000Z'
  const fact = (key: string, value: string) => ({
    type: 'attention_item', key, value, confidence: null,
    sourceIds: ['action-9'], detectedAt, occurredAt: null, dueAt: null, validUntil: null,
  })
  return {
    id: 'attention:old-action:site-1:action-9',
    organizationId: 'org-1',
    siteId: 'site-1',
    category: 'staleness',
    trigger: { type: 'old_action', reason: 'object_aging' },
    severity: 'warning',
    importance: 'high',
    urgency: 'today',
    state: 'active',
    actionability: 'direct',
    origin: 'rules',
    facts: [
      fact('what', '2 actions anciennes'),
      fact('why', 'ouverte depuis 27 j'),
      fact('where', 'Chantier Pointière'),
    ],
    rules: [{ id: 'old_action', version: '1' }],
    sources: [{ type: 'action', id: 'action-9', href: '/sites/site-1/actions', label: 'Reboucher la tranchée' }],
    actions: [{ kind: 'open', label: 'Ouvrir', href: '/sites/site-1/actions' }],
    confidence: null,
    dedupeKey: 'old-action:site-1:action-9',
    detectedAt,
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  }
}

describe('stale_action — presenter', () => {
  it('mappe le signal staleness/old_action en Situation, faits inchangés', () => {
    const situation = presentSituation(staleActionSignal(), '2026-07-25T08:00:00.000Z')

    expect(situation).toEqual(expect.objectContaining({
      id: 'attention:old-action:site-1:action-9',
      kind: 'stale_action',
      severity: 'warning',
      title: '2 actions anciennes',
      site: expect.objectContaining({
        id: 'site-1',
        name: 'Chantier Pointière',        // vient du fact `where`
        organizationId: 'org-1',
      }),
      timing: expect.objectContaining({
        label: 'ouverte depuis 27 j',       // vient du fact `why`
        ageDays: null,                       // pas de recalcul : `why` porte déjà l'âge
      }),
      source: expect.objectContaining({
        type: 'action',
        href: '/sites/site-1/actions',
        label: 'Reboucher la tranchée',
      }),
      capabilities: [
        { kind: 'open_source', label: 'Voir la source', href: '/sites/site-1/actions' },
      ],
    }))
    // Minimal : pas de nom d'org dans le signal → pas inventé.
    expect(situation?.site.organizationName).toBeNull()
    // Aucun vocabulaire de promesse ne fuit dans une action ancienne.
    expect(`${situation?.title} ${situation?.timing.label}`).not.toMatch(/promesse|échéance/i)
  })
})

describe('stale_action — projection AttentionCard', () => {
  it('projette une card ambre, icône warning, avec l\'action « Voir la source »', () => {
    const situation = presentSituation(staleActionSignal(), '2026-07-25T08:00:00.000Z')
    const card = projectSituationForAttention(situation)

    expect(card).toEqual(expect.objectContaining({
      id: 'attention:old-action:site-1:action-9',
      icon: 'warning',
      tone: 'amber',                          // severity warning → amber
      title: '2 actions anciennes',
      siteLabel: 'Chantier Pointière',
      timingLabel: 'ouverte depuis 27 j',
      sourceLabel: 'Reboucher la tranchée',
      primaryAction: { kind: 'open_source', label: 'Voir la source', href: '/sites/site-1/actions' },
      secondaryActions: [],
    }))
  })

  it('severity critical → tone red', () => {
    const situation = presentSituation(staleActionSignal({ severity: 'critical' }))
    expect(projectSituationForAttention(situation)?.tone).toBe('red')
  })
})

describe('stale_action — compose end-to-end', () => {
  it('un signal staleness produit une AttentionCard via la chaîne complète', () => {
    const cards = composeAttentionCardsFromSignals([staleActionSignal()])
    expect(cards).toHaveLength(1)
    expect(cards[0]).toEqual(expect.objectContaining({ title: '2 actions anciennes', tone: 'amber', icon: 'warning' }))
  })

  it('les familles NON migrées ne deviennent PAS des cards (migration une à une)', () => {
    // Un débrief en attente n'est pas encore migré → reste en AttentionRow, aucune card.
    const debrief = staleActionSignal({
      id: 'attention:pending-debrief:site-1',
      trigger: { type: 'missing_attachment', reason: 'attachment_missing' } as MemorySignal['trigger'],
    })
    expect(composeAttentionCardsFromSignals([debrief])).toEqual([])
  })
})
