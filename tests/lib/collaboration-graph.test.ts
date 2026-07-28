// Graphe de collaboration pondéré (V3 UX-1) — un AUTRE graphe : nœuds = acteurs,
// arête = relation agrégée (force → épaisseur, récence → transparence). Vérifie :
// une arête par couple, force = étape 3, récence = étape 4, pas de transitivité,
// vue Écosystème (entreprises seules), déterminisme.

import { describe, expect, it } from 'vitest'
import { buildCollaborationGraph, ecosystemView, collaborationEdgeWidth, collaborationEdgeAlpha, EDGE_WIDTH_MIN, EDGE_WIDTH_MAX } from '@/lib/knowledge/collaboration-graph'
import { aggregateActorRelations } from '@/lib/knowledge/actor-relations'
import type { ActorInteraction } from '@/lib/knowledge/actor-interactions'

const ASOF = new Date('2026-07-28T00:00:00Z')
const DAY = 86_400_000
const shift = (n: number): string => new Date(ASOF.getTime() + n * DAY).toISOString().slice(0, 10)

const casting = (siteId: string, from: string, to: string | null, a: string, b: string): ActorInteraction => {
  const [x, y] = `company:${a}` <= `company:${b}` ? [a, b] : [b, a]
  return { actorA: { kind: 'company', id: x }, actorB: { kind: 'company', id: y }, kind: 'co_casting', occurredAt: from, activeFrom: from, activeTo: to, siteId, sourceType: 'site_intervenant', sourceId: siteId }
}
const action = (id: string, occurredAt: string, person: string, company: string): ActorInteraction => {
  const a = { kind: 'person' as const, id: person }, b = { kind: 'company' as const, id: company }
  const [x, y] = `person:${person}` <= `company:${company}` ? [a, b] : [b, a]
  return { actorA: x, actorB: y, kind: 'co_action', occurredAt, actionId: id, sourceType: 'site_action', sourceId: id }
}

describe('buildCollaborationGraph', () => {
  it('une arête par couple, avec force et nœuds des deux acteurs', () => {
    const g = buildCollaborationGraph([
      casting('s1', shift(-800), null, 'coA', 'coB'),
      casting('s2', shift(-800), null, 'coA', 'coB'),
    ], ASOF)
    expect(g.edges).toHaveLength(1)             // un seul couple
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['coA', 'coB'])
    expect(g.edges[0]!.interactionCount).toBe(2) // deux co_casting non écrasés
  })

  it('la force de l’arête === score étape 3', () => {
    const ints = [casting('s1', shift(-800), null, 'coA', 'coB'), casting('s2', shift(-200), shift(-100), 'coA', 'coB')]
    const step3 = aggregateActorRelations(ints, ASOF)[0]!.rawStrength
    expect(buildCollaborationGraph(ints, ASOF).edges[0]!.strength).toBeCloseTo(step3)
  })

  it('récence : collaboration active → daysSinceLastInteraction 0', () => {
    const g = buildCollaborationGraph([casting('s1', shift(-800), null, 'coA', 'coB')], ASOF)
    expect(g.edges[0]!.daysSinceLastInteraction).toBe(0)
    expect(g.edges[0]!.activeInteractionCount).toBe(1)
  })

  it('aucune transitivité : A-B et B-C ne créent pas A-C', () => {
    const g = buildCollaborationGraph([
      casting('s1', shift(-10), null, 'coA', 'coB'),
      casting('s2', shift(-10), null, 'coB', 'coC'),
    ], ASOF)
    const pairs = g.edges.map((e) => [e.a.id, e.b.id].sort().join('-')).sort()
    expect(pairs).toEqual(['coA-coB', 'coB-coC']) // jamais coA-coC
    expect(g.nodes).toHaveLength(3)
  })

  it('déterministe : indépendant de l’ordre d’entrée', () => {
    const ints = [casting('s1', shift(-10), null, 'coA', 'coB'), action('a1', shift(-10), 'pX', 'coA')]
    expect(buildCollaborationGraph(ints, ASOF)).toEqual(buildCollaborationGraph([...ints].reverse(), ASOF))
  })

  it('graphe vide → vide', () => {
    expect(buildCollaborationGraph([], ASOF)).toEqual({ nodes: [], edges: [] })
  })
})

describe('transformations visuelles (bornées)', () => {
  it('épaisseur : monotone, plancher, et PLAFONNÉE (un outlier n’écrase pas le reste)', () => {
    expect(collaborationEdgeWidth(0)).toBeCloseTo(EDGE_WIDTH_MIN)
    expect(collaborationEdgeWidth(2)).toBeLessThan(collaborationEdgeWidth(4)) // monotone avant plafond
    expect(collaborationEdgeWidth(4)).toBeLessThan(collaborationEdgeWidth(6))
    expect(collaborationEdgeWidth(100000)).toBeLessThanOrEqual(EDGE_WIDTH_MAX) // plafond
    // Écarts nettement VISIBLES entre faible / moyen / fort (calibré sur la distribution réelle).
    expect(collaborationEdgeWidth(6) - collaborationEdgeWidth(2)).toBeGreaterThan(2)
  })

  it('transparence : récent opaque, ancien pâle mais visible (plancher 0,3)', () => {
    expect(collaborationEdgeAlpha(0)).toBe(1)
    expect(collaborationEdgeAlpha(200)).toBe(0.7)
    expect(collaborationEdgeAlpha(500)).toBe(0.45)
    expect(collaborationEdgeAlpha(2000)).toBe(0.3) // jamais 0
  })

  it('breakdown par type porté par l’arête', () => {
    const g = buildCollaborationGraph([casting('s1', shift(-10), null, 'coA', 'coB'), casting('s2', shift(-10), null, 'coA', 'coB')], ASOF)
    expect(g.edges[0]!.breakdown).toEqual({ co_casting: 2, co_action: 0, co_team: 0 })
  })
})

describe('ecosystemView (entreprises seules)', () => {
  it('ne garde que les arêtes entreprise↔entreprise (personnes/actions disparaissent)', () => {
    const full = buildCollaborationGraph([
      casting('s1', shift(-10), null, 'coA', 'coB'),   // company↔company
      action('a1', shift(-10), 'pX', 'coA'),           // person↔company
    ], ASOF)
    const eco = ecosystemView(full)
    expect(eco.edges).toHaveLength(1)
    expect(eco.edges[0]!.a.kind).toBe('company')
    expect(eco.edges[0]!.b.kind).toBe('company')
    expect(eco.nodes.every((n) => n.kind === 'company')).toBe(true)
    expect(eco.nodes.map((n) => n.id).sort()).toEqual(['coA', 'coB']) // pX (personne) disparaît
  })
})
