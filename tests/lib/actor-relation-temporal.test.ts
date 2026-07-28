// Dimensions temporelles (V3 étape 4) — activité, évolution du score et tendance
// SÉPARÉES. Couvre le contrat Vincent (25 cas + invariants) : fenêtres demi-ouvertes,
// ponctuel vs durée, durée longue = stable (pas « en baisse »), calcul historique
// sans fait futur, baisse mécanique ≠ tendance décroissante.

import { describe, expect, it } from 'vitest'
import {
  computeRelationTemporalMetrics,
  RELATION_ACTIVITY_WINDOW_DAYS, MIN_COMPARABLE_ACTIVITY_WEIGHT,
  INCREASING_ACTIVITY_RATIO, DECREASING_ACTIVITY_RATIO,
} from '@/lib/knowledge/actor-relation-temporal'
import { aggregateActorRelations } from '@/lib/knowledge/actor-relations'
import type { ActorInteraction } from '@/lib/knowledge/actor-interactions'

const ASOF = new Date('2026-07-28T00:00:00Z')
const DAY = 86_400_000
const shift = (n: number): string => new Date(ASOF.getTime() + n * DAY).toISOString().slice(0, 10)

const action = (id: string, occurredAt: string, a = 'pA', b = 'coA'): ActorInteraction => ({
  actorA: { kind: 'person', id: a }, actorB: { kind: 'company', id: b },
  kind: 'co_action', occurredAt, actionId: id, sourceType: 'site_action', sourceId: id,
})
const casting = (siteId: string, from: string, to: string | null, a = 'coA', b = 'coB'): ActorInteraction => ({
  actorA: { kind: 'company', id: a }, actorB: { kind: 'company', id: b },
  kind: 'co_casting', occurredAt: from, activeFrom: from, activeTo: to, siteId, sourceType: 'site_intervenant', sourceId: siteId,
})
const m = (ints: ActorInteraction[]) => computeRelationTemporalMetrics(ints, ASOF)

describe('fenêtres & comptage', () => {
  it('1-2. action dans la fenêtre courante / précédente', () => {
    expect(m([action('a', shift(-30))]).activity.current.eventCount).toBe(1)
    expect(m([action('a', shift(-30))]).activity.previous.eventCount).toBe(0)
    expect(m([action('a', shift(-120))]).activity.previous.eventCount).toBe(1)
    expect(m([action('a', shift(-120))]).activity.current.eventCount).toBe(0)
  })

  it('3-4. bornes exactes : une interaction n’appartient jamais aux deux fenêtres', () => {
    expect(m([action('a', shift(0))]).activity.current.eventCount).toBe(1)        // asOf → courante (haute inclusive)
    const onBoundary = m([action('a', shift(-RELATION_ACTIVITY_WINDOW_DAYS))])     // asOf-90 → précédente seulement
    expect(onBoundary.activity.previous.eventCount).toBe(1)
    expect(onBoundary.activity.current.eventCount).toBe(0)
    expect(m([action('a', shift(-180))]).activity.previous.eventCount).toBe(0)     // asOf-180 exclu
  })

  it('5-7. durée : chevauchement courant seul / précédent seul / les deux', () => {
    expect(m([casting('s', shift(-30), null)]).activity.current.activeDurationCount).toBe(1)
    expect(m([casting('s', shift(-30), null)]).activity.previous.activeDurationCount).toBe(0)
    expect(m([casting('s', shift(-170), shift(-100))]).activity.previous.activeDurationCount).toBe(1)
    expect(m([casting('s', shift(-170), shift(-100))]).activity.current.activeDurationCount).toBe(0)
    const both = m([casting('s', shift(-200), null)])
    expect(both.activity.current.activeDurationCount).toBe(1)
    expect(both.activity.previous.activeDurationCount).toBe(1)
  })

  it('8. durée active depuis des années → activité stable (pas « en baisse »)', () => {
    const r = m([casting('s', shift(-800), null)])
    expect(r.activity.current.contribution).toBe(2)
    expect(r.activity.previous.contribution).toBe(2)
    expect(r.activity.trend).toBe('stable')
  })
})

describe('tendance', () => {
  it('9. plusieurs événements courants → increasing', () => {
    const r = m([action('p', shift(-120)), action('c1', shift(-10)), action('c2', shift(-20))])
    expect(r.activity.trend).toBe('increasing') // 6 vs 3 → ratio 2
  })
  it('10. baisse significative → decreasing', () => {
    const r = m([action('p1', shift(-100)), action('p2', shift(-110)), action('c', shift(-10))])
    expect(r.activity.trend).toBe('decreasing') // 3 vs 6 → ratio 0,5
  })
  it('11. variation faible → stable', () => {
    const r = m([action('p', shift(-120)), action('c', shift(-30))])
    expect(r.activity.trend).toBe('stable') // 3 vs 3
  })
  it('12. activité uniquement courante → new', () => {
    expect(m([action('c', shift(-30))]).activity.trend).toBe('new')
  })
  it('13. rien de récent mais historique ancien → inactive', () => {
    expect(m([action('old', shift(-400))]).activity.trend).toBe('inactive')
  })
  it('14. faible volume non comparable → insufficient_data', () => {
    expect(m([action('p', shift(-120))]).activity.trend).toBe('insufficient_data') // 0 vs 3, somme 3 < 4
  })
})

describe('récence', () => {
  it('15. ageInDays = jours depuis la première interaction observée', () => {
    expect(m([action('old', shift(-400)), action('c', shift(-10))]).ageInDays).toBe(400)
  })
  it('16. durée active → daysSinceLastInteraction = 0', () => {
    expect(m([casting('s', shift(-800), null)]).daysSinceLastInteraction).toBe(0)
  })
  it('17. relation terminée → récence sur la dernière date observée', () => {
    expect(m([casting('s', shift(-800), shift(-200))]).daysSinceLastInteraction).toBe(200)
  })
})

describe('évolution du score (mécanique) & calcul historique', () => {
  it('18. strengthEvolution.current === score étape 3 à asOf', () => {
    const ints = [action('a1', shift(-10)), action('a2', shift(-400))]
    const step3 = aggregateActorRelations(ints, ASOF)[0]!.rawStrength
    expect(m(ints).strengthEvolution.current).toBeCloseTo(step3)
  })
  it('19. le passé exclut une action postérieure à previousAsOf', () => {
    // -400 existait à previousAsOf ; -30 (postérieur à asOf-90) NON.
    const r = m([action('old', shift(-400)), action('recent', shift(-30))])
    expect(r.strengthEvolution.previous).toBeCloseTo(2.25) // seulement -400, âge 310 à prevAsOf → 3×0,75
  })
  it('20. le passé exclut une durée non commencée à previousAsOf', () => {
    const r = m([casting('s', shift(-30), null)]) // débute après asOf-90
    expect(r.strengthEvolution.previous).toBe(0)
    expect(r.strengthEvolution.current).toBeCloseTo(2)
  })
  it('21. une durée active à previousAsOf utilise cette date comme référence (pas activeFrom)', () => {
    const r = m([casting('s', shift(-800), null)])
    expect(r.strengthEvolution.previous).toBeCloseTo(2) // active → référence = prevAsOf → facteur 1 (pas 0,25)
    expect(r.strengthEvolution.current).toBeCloseTo(2)
  })
  it('22. baisse MÉCANIQUE du score ne force PAS une tendance decreasing', () => {
    const r = m([action('old', shift(-400))]) // 0,5 à asOf ; 0,75 à prevAsOf
    expect(r.strengthEvolution.delta).toBeLessThan(0) // -0,75 (décote seule)
    expect(r.activity.trend).not.toBe('decreasing')
    expect(r.activity.trend).toBe('inactive')
  })
})

describe('robustesse & invariants', () => {
  it('23. résultat indépendant de l’ordre d’entrée', () => {
    const ints = [action('a1', shift(-10)), action('a2', shift(-120)), action('a3', shift(-400))]
    expect(m(ints)).toEqual(m([...ints].reverse()))
  })
  it('24. les entrées ne sont pas mutées', () => {
    const ints = [action('a1', shift(-10)), casting('s', shift(-800), null)]
    const snapshot = JSON.parse(JSON.stringify(ints))
    m(ints)
    expect(ints).toEqual(snapshot)
  })
  it('25. seuils et fenêtres centralisés', () => {
    expect(RELATION_ACTIVITY_WINDOW_DAYS).toBe(90)
    expect(MIN_COMPARABLE_ACTIVITY_WEIGHT).toBe(4)
    expect(INCREASING_ACTIVITY_RATIO).toBe(1.5)
    expect(DECREASING_ACTIVITY_RATIO).toBe(0.67)
  })
  it('invariant : activity.delta === current.contribution - previous.contribution', () => {
    const r = m([action('p', shift(-120)), action('c1', shift(-10)), action('c2', shift(-20))])
    expect(r.activity.delta).toBeCloseTo(r.activity.current.contribution - r.activity.previous.contribution)
  })
  it('invariant : strengthEvolution.delta === current - previous', () => {
    const r = m([action('old', shift(-400)), action('c', shift(-10))])
    expect(r.strengthEvolution.delta).toBeCloseTo(r.strengthEvolution.current - r.strengthEvolution.previous)
  })
})

describe('exemples chiffrés', () => {
  it('A. relation structurelle STABLE : casting actif → activité stable, force stable', () => {
    const r = m([casting('s', shift(-800), null)])
    expect(r.activity.trend).toBe('stable')
    expect(r.strengthEvolution.delta).toBeCloseTo(0) // 2 → 2, aucune baisse
    expect(r.daysSinceLastInteraction).toBe(0)
  })
  it('B. force qui BAISSE mécaniquement sans tendance décroissante', () => {
    const r = m([action('old', shift(-400))]) // aucune activité récente
    expect(r.strengthEvolution.current).toBeCloseTo(1.5)  // 3 × 0,5
    expect(r.strengthEvolution.previous).toBeCloseTo(2.25) // 3 × 0,75
    expect(r.strengthEvolution.delta).toBeCloseTo(-0.75)   // pure décote
    expect(r.activity.trend).toBe('inactive')             // jamais « decreasing »
  })
})
