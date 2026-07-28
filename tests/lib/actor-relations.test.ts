// Agrégation en force de relation (V3 étape 3) — score BRUT récencé + détail
// entièrement recalculable. Aucune normalisation, aucun qualificatif. Couvre le
// contrat Vincent (18 cas + invariant somme = rawStrength).

import { describe, expect, it } from 'vitest'
import { aggregateActorRelations, getRecencyFactor, INTERACTION_WEIGHTS } from '@/lib/knowledge/actor-relations'
import type { ActorInteraction } from '@/lib/knowledge/actor-interactions'

const ASOF = new Date('2026-07-28T00:00:00Z')

// Fabriques de faits (couple déjà canonique, comme l'étape 2 le produit).
const coAction = (id: string, occurredAt: string, a = 'pA', b = 'coA'): ActorInteraction => ({
  actorA: { kind: 'person', id: a }, actorB: { kind: 'company', id: b },
  kind: 'co_action', occurredAt, actionId: id, sourceType: 'site_action', sourceId: id,
})
const coCasting = (siteId: string, activeFrom: string, activeTo: string | null, a = 'coA', b = 'coB'): ActorInteraction => ({
  actorA: { kind: 'company', id: a }, actorB: { kind: 'company', id: b },
  kind: 'co_casting', occurredAt: activeFrom, activeFrom, activeTo, siteId, sourceType: 'site_intervenant', sourceId: siteId,
})
const coTeam = (teamId: string, activeFrom: string, activeTo: string | null, a = 'pA', b = 'pB'): ActorInteraction => ({
  actorA: { kind: 'person', id: a }, actorB: { kind: 'person', id: b },
  kind: 'co_team', occurredAt: activeFrom, activeFrom, activeTo, teamId, sourceType: 'team_field_member', sourceId: teamId,
})

const only = (rs: ReturnType<typeof aggregateActorRelations>) => { expect(rs).toHaveLength(1); return rs[0]! }

describe('aggregateActorRelations', () => {
  it('1. un seul fait → une seule relation', () => {
    const r = only(aggregateActorRelations([coAction('a1', '2026-07-20')], ASOF))
    expect(r.interactionCount).toBe(1)
    expect(r.rawStrength).toBeCloseTo(3)
  })

  it('2. plusieurs faits du même couple sont additionnés', () => {
    const r = only(aggregateActorRelations([coAction('a1', '2026-07-20'), coAction('a2', '2026-07-10')], ASOF))
    expect(r.interactionCount).toBe(2)
    expect(r.rawStrength).toBeCloseTo(6) // 3 + 3 (deux récentes)
  })

  it('3. A–B et B–A restent un seul couple (déjà canonique en amont)', () => {
    // Deux faits du même couple canonique → une relation, jamais deux.
    const rs = aggregateActorRelations([coCasting('s1', '2026-01-01', null), coCasting('s2', '2026-02-01', null)], ASOF)
    expect(rs).toHaveLength(1)
    expect(rs[0]!.interactionCount).toBe(2)
  })

  it('4. les poids 3 / 2 / 2 sont appliqués', () => {
    expect(INTERACTION_WEIGHTS).toEqual({ co_action: 3, co_casting: 2, co_team: 2 })
    const r = only(aggregateActorRelations([coCasting('s1', '2026-07-01', null)], ASOF))
    expect(r.breakdown.co_casting.rawStrength).toBeCloseTo(2)
  })

  it('5. une action récente reçoit un facteur de 1', () => {
    const r = only(aggregateActorRelations([coAction('a1', '2026-07-01')], ASOF)) // 27 j
    expect(r.contributions[0]!.recencyFactor).toBe(1)
    expect(r.contributions[0]!.weightedContribution).toBeCloseTo(3)
  })

  it('6. une action ancienne reçoit la bonne décote', () => {
    // ~14 mois → 0,5
    const r = only(aggregateActorRelations([coAction('a1', '2025-05-20')], ASOF))
    expect(r.contributions[0]!.recencyFactor).toBe(0.5)
    expect(r.rawStrength).toBeCloseTo(1.5)
  })

  it('7. période TOUJOURS ACTIVE → référence = asOf (donc récente)', () => {
    const r = only(aggregateActorRelations([coCasting('s1', '2023-03-01', null)], ASOF))
    expect(r.contributions[0]!.referenceDate).toBe('2026-07-28') // asOf, pas activeFrom
    expect(r.contributions[0]!.recencyFactor).toBe(1)
  })

  it('8. période TERMINÉE → référence = activeTo', () => {
    const r = only(aggregateActorRelations([coTeam('t1', '2022-01-01', '2023-06-30')], ASOF))
    expect(r.contributions[0]!.referenceDate).toBe('2023-06-30')
    expect(r.contributions[0]!.recencyFactor).toBe(0.25) // > 2 ans
  })

  it('9. deux occurrences distinctes de même type ne sont pas écrasées', () => {
    const r = only(aggregateActorRelations([coAction('a1', '2026-07-20'), coAction('a2', '2026-07-21')], ASOF))
    expect(r.breakdown.co_action.count).toBe(2)
    expect(r.contributions).toHaveLength(2)
  })

  it('10. le détail par type correspond au score total', () => {
    // NB : un couple n'accumule qu'UN type de signal aujourd'hui (typage honnête,
    // non transitif) — ici person↔company ⇒ co_action seulement. La somme du
    // breakdown (tous types) reste égale au score total.
    const r = only(aggregateActorRelations([coAction('a1', '2026-07-20'), coAction('a2', '2025-05-20')], ASOF))
    const sumBreakdown = r.breakdown.co_action.rawStrength + r.breakdown.co_casting.rawStrength + r.breakdown.co_team.rawStrength
    expect(sumBreakdown).toBeCloseTo(r.rawStrength)
  })

  it('11. la somme des contributions === rawStrength (invariant)', () => {
    const r = only(aggregateActorRelations([
      coAction('a1', '2026-07-20'), coAction('a2', '2025-05-20'), coAction('a3', '2024-01-01'),
    ], ASOF))
    const sum = r.contributions.reduce((s, c) => s + c.weightedContribution, 0)
    expect(r.rawStrength).toBeCloseTo(sum)
  })

  it('12. firstInteractionAt / lastInteractionAt corrects', () => {
    const r = only(aggregateActorRelations([coAction('a1', '2025-01-10'), coAction('a2', '2026-07-01')], ASOF))
    expect(r.firstInteractionAt).toBe('2025-01-10')
    expect(r.lastInteractionAt).toBe('2026-07-01')
  })

  it('13. activeInteractionCount ne compte que les durées actives (co_action jamais active)', () => {
    const r = only(aggregateActorRelations([
      coCasting('s1', '2026-01-01', null),        // actif
      coCasting('s2', '2024-01-01', '2024-12-31', 'coA', 'coB'), // terminé
    ], ASOF))
    expect(r.activeInteractionCount).toBe(1)

    const r2 = only(aggregateActorRelations([coAction('a1', '2026-07-01')], ASOF))
    expect(r2.activeInteractionCount).toBe(0) // ponctuel jamais actif
  })

  it('14. le résultat ne dépend pas de l’ordre des interactions', () => {
    const facts = [coAction('a1', '2026-07-20'), coCasting('s1', '2026-01-01', null), coAction('a2', '2025-05-20')]
    const forward = aggregateActorRelations(facts, ASOF)
    const backward = aggregateActorRelations([...facts].reverse(), ASOF)
    expect(forward).toEqual(backward)
  })

  it('15. deux couples différents produisent deux relations', () => {
    const rs = aggregateActorRelations([coAction('a1', '2026-07-20', 'pA', 'coA'), coAction('a2', '2026-07-20', 'pB', 'coB')], ASOF)
    expect(rs).toHaveLength(2)
  })

  it('16. aucune transitivité : A–B et B–C ne créent pas A–C', () => {
    const rs = aggregateActorRelations([
      coTeam('t1', '2026-01-01', null, 'pA', 'pB'),
      coTeam('t2', '2026-01-01', null, 'pB', 'pC'),
    ], ASOF)
    const pairs = rs.map((r) => `${r.actorA.id}-${r.actorB.id}`)
    expect(pairs.sort()).toEqual(['pA-pB', 'pB-pC']) // jamais pA-pC
  })

  it('17. utilise le asOf fourni et reste déterministe', () => {
    const past = new Date('2025-01-01T00:00:00Z')
    const r = only(aggregateActorRelations([coAction('a1', '2026-07-01')], past))
    // occurredAt POSTÉRIEUR à asOf → date future → facteur 1 (jamais > 1).
    expect(r.contributions[0]!.recencyFactor).toBe(1)
  })

  it('18. une date future ne produit pas de facteur supérieur à 1', () => {
    expect(getRecencyFactor(new Date('2027-01-01T00:00:00Z'), ASOF)).toBe(1)
    expect(getRecencyFactor(ASOF, ASOF)).toBe(1)
  })

  it('exemple chiffré réaliste (entreprise↔entreprise) + invariant', () => {
    // Un couple d'ENTREPRISES accumule des co_casting (mono-type aujourd'hui).
    const r = only(aggregateActorRelations([
      coCasting('s1', '2023-01-01', null),      // active : 2 × 1 = 2
      coCasting('s2', '2020-01-01', '2023-06-30'), // terminée > 2 ans : 2 × 0,25 = 0,5
    ], ASOF))
    expect(r.rawStrength).toBeCloseTo(2.5)
    expect(r.activeInteractionCount).toBe(1)
    const sum = r.contributions.reduce((s, c) => s + c.weightedContribution, 0)
    expect(r.rawStrength).toBeCloseTo(sum)
  })
})
