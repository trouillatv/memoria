// ── GRAPHE DE COLLABORATION PONDÉRÉ (V3 UX-1) ────────────────────────────────
// PUR : un AUTRE graphe (pas un filtre du structurel). Nœuds = acteurs ; une arête
// par couple = leur RELATION AGRÉGÉE (étape 5) — force (→ épaisseur), récence (→
// transparence), tendance. « Qui travaille réellement ensemble ». Strictement
// dérivé des faits (étapes 2-4), aucune transitivité, aucune donnée nouvelle.
//
// La vue « Écosystème » (entreprises uniquement) est le MÊME graphe filtré aux
// nœuds/arêtes entreprise↔entreprise — pas un modèle distinct.

import { aggregateActorRelations } from './actor-relations'
import { computeRelationTemporalMetrics, type RelationActivityTrend } from './actor-relation-temporal'
import type { ActorInteraction, ActorRef } from './actor-interactions'
import type { AttentionLevel } from './actor-attention'

export interface CollaborationBreakdown { co_casting: number; co_action: number; co_team: number }

export interface CollaborationEdge {
  /** Couple canonique (refKey(a) <= refKey(b)). */
  a: ActorRef
  b: ActorRef
  /** Force brute récencée (étape 3) → épaisseur du lien. */
  strength: number
  interactionCount: number
  /** Récence effective (0 si collaboration active) → transparence (récent = opaque). */
  daysSinceLastInteraction: number
  trend: RelationActivityTrend
  activeInteractionCount: number
  /** Répartition des interactions par type (pour l'inspecteur — « pourquoi proches »). */
  breakdown: CollaborationBreakdown
}

export interface CollaborationGraph {
  nodes: ActorRef[] // acteurs présents dans au moins une collaboration
  edges: CollaborationEdge[]
}

// ── Vue RENDU (résolue côté serveur : libellés, entreprise-fond, état) ──
export interface CollaborationNodeView {
  key: string           // refKey (kind:id)
  kind: 'person' | 'company'
  id: string
  label: string
  companyId: string | null // fond coloré par organisation
  level: AttentionLevel    // halo d'attention
}
export interface CollaborationEdgeView {
  a: string; b: string   // refKeys
  strength: number
  interactionCount: number
  daysSinceLastInteraction: number
  trend: RelationActivityTrend
  activeInteractionCount: number
  breakdown: CollaborationBreakdown
}
export interface CollaborationGraphView {
  nodes: CollaborationNodeView[]
  edges: CollaborationEdgeView[]
}

const refKey = (r: ActorRef): string => `${r.kind}:${r.id}`

/** Compose le graphe de collaboration à partir des faits élémentaires. Déterministe :
 *  une arête par couple, nœuds/arêtes triés. */
export function buildCollaborationGraph(interactions: ActorInteraction[], asOf: Date): CollaborationGraph {
  const byPair = new Map<string, ActorInteraction[]>()
  for (const i of interactions) {
    const key = `${refKey(i.actorA)}|${refKey(i.actorB)}`
    if (!byPair.has(key)) byPair.set(key, [])
    byPair.get(key)!.push(i)
  }

  const nodeByKey = new Map<string, ActorRef>()
  const edges: CollaborationEdge[] = []
  for (const facts of byPair.values()) {
    const relation = aggregateActorRelations(facts, asOf)[0]!
    const temporal = computeRelationTemporalMetrics(facts, asOf)
    const a = relation.actorA, b = relation.actorB
    nodeByKey.set(refKey(a), a)
    nodeByKey.set(refKey(b), b)
    edges.push({
      a, b,
      strength: relation.rawStrength,
      interactionCount: relation.interactionCount,
      daysSinceLastInteraction: temporal.daysSinceLastInteraction,
      trend: temporal.activity.trend,
      activeInteractionCount: relation.activeInteractionCount,
      breakdown: {
        co_casting: relation.breakdown.co_casting.count,
        co_action: relation.breakdown.co_action.count,
        co_team: relation.breakdown.co_team.count,
      },
    })
  }

  edges.sort((x, y) => {
    const kx = `${refKey(x.a)}|${refKey(x.b)}`, ky = `${refKey(y.a)}|${refKey(y.b)}`
    return kx < ky ? -1 : kx > ky ? 1 : 0
  })
  const nodes = [...nodeByKey.values()].sort((p, q) => (refKey(p) < refKey(q) ? -1 : refKey(p) > refKey(q) ? 1 : 0))
  return { nodes, edges }
}

// ── Transformations VISUELLES (bornées, robustes à une distribution asymétrique) ──
// Calibré sur la distribution réelle observée (forces ~0,5 → 6) : l'écart doit être
// PERCEPTIBLE — faible ≈ 1,6 px · moyen ≈ 3,5 px · fort ≈ 7,8 px.
export const EDGE_WIDTH_MIN = 0.8
export const EDGE_WIDTH_MAX = 11

/** Épaisseur d'un lien depuis la force : monotone + PLAFOND. Exposant < 1 (compression
 *  douce) pour garder des écarts nets entre faible/moyen/fort ; le plafond empêche une
 *  relation exceptionnelle d'écraser toutes les autres. */
export function collaborationEdgeWidth(strength: number): number {
  return Math.min(EDGE_WIDTH_MAX, EDGE_WIDTH_MIN + 1.5 * Math.pow(Math.max(0, strength), 0.85))
}

/** Transparence depuis la récence : récent = opaque, ancien = pâle mais VISIBLE
 *  (plancher 0,3 — les relations anciennes restent secondaires, jamais effacées). */
export function collaborationEdgeAlpha(daysSinceLastInteraction: number): number {
  const d = daysSinceLastInteraction
  if (d <= 90) return 1
  if (d <= 365) return 0.7
  if (d <= 730) return 0.45
  return 0.3
}

/** Vue ÉCOSYSTÈME : le graphe de collaboration réduit aux ENTREPRISES (personnes,
 *  équipes, actions disparaissent). Ne garde que les arêtes entreprise↔entreprise. */
export function ecosystemView(graph: CollaborationGraph): CollaborationGraph {
  const edges = graph.edges.filter((e) => e.a.kind === 'company' && e.b.kind === 'company')
  const keep = new Set<string>()
  for (const e of edges) { keep.add(refKey(e.a)); keep.add(refKey(e.b)) }
  return { nodes: graph.nodes.filter((n) => keep.has(refKey(n))), edges }
}
