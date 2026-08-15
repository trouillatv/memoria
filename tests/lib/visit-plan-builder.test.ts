// Plan de visite — hiérarchie terrain et contrôles (P1-A.1, 2026-08-15).
//
// Le défaut prouvé en recette PETRO : cinq recommandations plates, toutes `low`,
// toutes portant la même raison « Évolution depuis votre dernière visite ». Ces
// tests protègent l'invariant produit : le moteur doit pouvoir répondre
// « pourquoi celui-là est dans ma visite ? » avec une raison propre à chacun.

import { describe, it, expect } from 'vitest'
import { buildVisitPlan, buildSpokenPlanContract } from '@/lib/visits/visit-plan-builder'
import type { SiteAttentionItem } from '@/lib/knowledge/site-attention-items'

const LAST_VISIT = '2026-08-01T00:00:00.000Z'

function item(over: Partial<SiteAttentionItem> & { signal: SiteAttentionItem['signal'] }): SiteAttentionItem {
  return {
    title: 'Sujet',
    reason: 'raison',
    urgency: 'low',
    href: '/x',
    ...over,
    metadata: { lastVisitAt: LAST_VISIT, ...over.metadata },
  }
}

describe('buildVisitPlan — hiérarchie de visite', () => {
  it('ordonne sécurité → modifié → récurrent → engagement → autre, avant l’urgence', () => {
    const plan = buildVisitPlan(
      [
        item({ signal: 'action_overdue', title: 'Action', urgency: 'high', metadata: { canonicalSubjectId: 'a' } }),
        item({ signal: 'subject_changed', title: 'Modifié', urgency: 'low', metadata: { canonicalSubjectId: 'b' } }),
        item({ signal: 'reserve_open', title: 'Réserve', urgency: 'medium', metadata: { canonicalSubjectId: 'c' } }),
        item({ signal: 'subject_stagnant', title: 'Stagnant', urgency: 'high', metadata: { canonicalSubjectId: 'd' } }),
      ],
      [{ canonicalSubjectId: 'e', label: 'PV', signals: ['non conforme'] }],
      10,
    )
    expect(plan.map((c) => c.label)).toEqual(['Réserve', 'Modifié', 'Stagnant', 'Action', 'PV'])
    expect(plan.map((c) => c.tier)).toEqual([
      'safety_open', 'changed_since', 'recurring_unsolved', 'commitment_check', 'other',
    ])
  })

  it('une réserve ouverte medium passe devant un sujet modifié low', () => {
    const plan = buildVisitPlan(
      [
        item({ signal: 'subject_changed', title: 'Modifié', urgency: 'low', metadata: { canonicalSubjectId: 'b' } }),
        item({ signal: 'reserve_open', title: 'Réserve', urgency: 'medium', metadata: { canonicalSubjectId: 'c' } }),
      ],
      [], 10,
    )
    expect(plan[0].label).toBe('Réserve')
  })

  it('trie par urgence à l’intérieur d’une même famille', () => {
    const plan = buildVisitPlan(
      [
        item({ signal: 'reserve_open', title: 'B', urgency: 'medium', metadata: { canonicalSubjectId: '2' } }),
        item({ signal: 'blocage_active', title: 'A', urgency: 'critical', metadata: { canonicalSubjectId: '1' } }),
      ],
      [], 10,
    )
    expect(plan.map((c) => c.label)).toEqual(['A', 'B'])
  })

  it('déduplique par sujet canonique et respecte le maximum', () => {
    const plan = buildVisitPlan(
      [
        item({ signal: 'reserve_open', title: 'X', metadata: { canonicalSubjectId: 'same' } }),
        item({ signal: 'subject_changed', title: 'X bis', metadata: { canonicalSubjectId: 'same' } }),
        item({ signal: 'action_overdue', title: 'Y', metadata: { canonicalSubjectId: 'other' } }),
      ],
      [{ canonicalSubjectId: 'same', label: 'X ter', signals: [] }],
      1,
    )
    expect(plan).toHaveLength(1)
    expect(plan[0].label).toBe('X')
  })
})

describe('buildVisitPlan — contrôles terrain', () => {
  it('produit un « quoi vérifier » distinct par nature de signal', () => {
    const plan = buildVisitPlan(
      [
        item({ signal: 'reserve_open', title: 'A', metadata: { canonicalSubjectId: '1' } }),
        item({ signal: 'subject_changed', title: 'B', metadata: { canonicalSubjectId: '2' } }),
        item({ signal: 'action_overdue', title: 'C', metadata: { canonicalSubjectId: '3' } }),
      ],
      [], 10,
    )
    const checks = plan.map((c) => c.check)
    expect(new Set(checks).size).toBe(3)
    for (const c of checks) expect(c.length).toBeGreaterThan(10)
  })

  it('différencie le « pourquoi » de deux sujets modifiés — le défaut de la recette', () => {
    const plan = buildVisitPlan(
      [
        item({
          signal: 'subject_changed', title: 'Tableau électrique',
          reason: 'Évolution depuis votre dernière visite',
          metadata: {
            canonicalSubjectId: '1',
            lastMeaningfulChangeAt: '2026-08-10T00:00:00.000Z',
            changedSinceLastVisit: true,
            activeObjects: { actionsOpen: 2, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 2 },
          },
        }),
        item({
          signal: 'subject_changed', title: 'Suie panneaux',
          reason: 'Évolution depuis votre dernière visite',
          metadata: {
            canonicalSubjectId: '2',
            lastMeaningfulChangeAt: '2026-08-12T00:00:00.000Z',
            changedSinceLastVisit: true,
            consecutiveMentionsWithoutChange: 3,
          },
        }),
      ],
      [], 10,
    )
    expect(plan[0].why).not.toBe(plan[1].why)
    expect(plan[0].why).toContain('2 actions ouvertes')
    expect(plan[1].why).toContain('3 fois de suite')
  })

  it('formule le dernier état connu depuis le statut et les objets actifs', () => {
    const [c] = buildVisitPlan(
      [
        item({
          signal: 'subject_stagnant', title: 'A',
          metadata: {
            canonicalSubjectId: '1',
            currentStatus: 'still_open',
            activeObjects: { actionsOpen: 1, reservesOpen: 2, deadlinesActive: 0, decisionsOpen: 0, total: 3 },
          },
        }),
      ],
      [], 10,
    )
    expect(c.lastKnown).toContain('toujours ouvert')
    expect(c.lastKnown).toContain('1 action ouverte')
    expect(c.lastKnown).toContain('2 réserves ouvertes')
  })

  it('sans donnée d’état, lastKnown reste null plutôt qu’une phrase vide', () => {
    const [c] = buildVisitPlan([item({ signal: 'reserve_open', metadata: { reserveId: 'r' } })], [], 10)
    expect(c.lastKnown).toBeNull()
  })

  it('formule l’ABSENCE d’évolution depuis la dernière visite', () => {
    const [c] = buildVisitPlan(
      [item({ signal: 'subject_stagnant', metadata: { canonicalSubjectId: '1', changedSinceLastVisit: false } })],
      [], 10,
    )
    expect(c.changeSinceLastVisit).toContain('Aucune évolution')
  })

  it('sans dernière visite connue, ne prétend rien sur le changement', () => {
    const plan = buildVisitPlan(
      [{ signal: 'reserve_open', title: 'A', reason: 'r', urgency: 'medium', href: '/x' }],
      [], 10,
    )
    expect(plan[0].changeSinceLastVisit).toBeNull()
  })
})

// D0 (2026-08-16) : le contrat oral doit exister AVANT l'appel au LLM, pas être
// vérifié après. `id` doit être stable et citable ; `buildSpokenPlanContract`
// doit être pur et ne dépendre d'aucun appel réseau.
describe('buildVisitPlan — id citable', () => {
  it('reprend le sujet canonique comme id quand il existe', () => {
    const plan = buildVisitPlan(
      [item({ signal: 'reserve_open', title: 'A', metadata: { canonicalSubjectId: 'cs-1' } })],
      [], 10,
    )
    expect(plan[0].id).toBe('cs-1')
  })

  it('retombe sur une position stable quand aucun sujet canonique n’est connu', () => {
    const plan = buildVisitPlan(
      [{ signal: 'reserve_open', title: 'A', reason: 'r', urgency: 'medium', href: '/x' }],
      [], 10,
    )
    expect(plan[0].id).toBe('vp-0')
  })

  it('ne produit jamais deux ids identiques dans le même plan', () => {
    const plan = buildVisitPlan(
      [
        item({ signal: 'reserve_open', title: 'A', metadata: { canonicalSubjectId: 'cs-1' } }),
        { signal: 'reserve_open', title: 'B', reason: 'r', urgency: 'medium', href: '/x' },
        { signal: 'action_overdue', title: 'C', reason: 'r', urgency: 'medium', href: '/x' },
      ],
      [], 10,
    )
    expect(new Set(plan.map((c) => c.id)).size).toBe(plan.length)
  })
})

describe('buildSpokenPlanContract', () => {
  it('donne le total exact et les 3 premiers contrôles dans l’ordre déjà trié', () => {
    const plan = buildVisitPlan(
      [
        item({ signal: 'blocage_active', title: 'A', metadata: { canonicalSubjectId: '1' } }),
        item({ signal: 'subject_changed', title: 'B', metadata: { canonicalSubjectId: '2' } }),
        item({ signal: 'subject_stagnant', title: 'C', metadata: { canonicalSubjectId: '3' } }),
        item({ signal: 'action_overdue', title: 'D', metadata: { canonicalSubjectId: '4' } }),
        item({ signal: 'reserve_open', title: 'E', metadata: { canonicalSubjectId: '5' } }),
      ],
      [], 10,
    )
    const contract = buildSpokenPlanContract(plan)
    expect(contract.total).toBe(5)
    expect(contract.resume.map((r) => r.label)).toEqual(plan.slice(0, 3).map((c) => c.label))
    expect(contract.resume.map((r) => r.id)).toEqual(plan.slice(0, 3).map((c) => c.id))
  })

  it('reste vide sans dépasser le nombre réel de contrôles', () => {
    const plan = buildVisitPlan([item({ signal: 'reserve_open', metadata: { canonicalSubjectId: '1' } })], [], 10)
    expect(buildSpokenPlanContract(plan).resume).toHaveLength(1)
  })
})
