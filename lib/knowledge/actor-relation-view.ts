// ── READ MODEL DES RELATIONS D'UN ACTEUR (V3, étape 5A) ──────────────────────
// PUR & déterministe : compose le pipeline complet pour l'UI, à partir des faits
// élémentaires (étape 2) d'UN acteur :
//   interactions → aggregateActorRelations → computeRelationTemporalMetrics → vues
// triées et EXPLIQUÉES. `asOf` injecté une seule fois ; aucun recalcul dans l'UI.
//
// Séparation nette : données de calcul (rawStrength, contributions), données
// d'affichage (activity/strengthEvolution/trend), preuves (explanation → sources
// réelles). AUCUN qualificatif métier, AUCUNE normalisation (hors périmètre : on
// attend l'observation des distributions réelles).

import { aggregateActorRelations } from './actor-relations'
import { computeRelationTemporalMetrics, type RelationActivityTrend } from './actor-relation-temporal'
import type { ActorInteraction, ActorInteractionKind, ActorRef } from './actor-interactions'

export type ActorRelationTrend = RelationActivityTrend

export interface ActorSummary {
  kind: 'person' | 'company'
  id: string
  label: string
  href: string | null
}

export interface ActorRelationExplanationItem {
  interactionType: ActorInteractionKind
  sourceId: string
  sourceLabel: string
  sourceHref: string | null
  /** Occurrence ponctuelle (co_action) : sa date ; durée : null (voir activeFrom/To). */
  observedAt: string | null
  activeFrom: string | null
  activeTo: string | null
  isActive: boolean
  rawContribution: number
  currentContribution: number
}

export interface ActorRelationView {
  actor: ActorSummary
  relationType: ActorInteractionKind
  rawStrength: number
  /** Valeur d'affichage = force brute (aucune normalisation à ce stade). */
  strength: number
  activity: { current: number; previous: number; delta: number; trend: ActorRelationTrend }
  strengthEvolution: { current: number; previous: number; delta: number }
  daysSinceLastInteraction: number
  activeInteractionCount: number
  interactionCount: number
  explanation: ActorRelationExplanationItem[]
}

export interface ActorEcosystem {
  principal: ActorRelationView[]
  recent: ActorRelationView[]   // trend 'new' | 'increasing'
  inactive: ActorRelationView[] // trend 'inactive' (encore une force)
}

/** Résolveurs de libellés/hrefs injectés (le serveur les branche sur la base ;
 *  les tests les simulent) — la logique reste pure et sans I/O. */
export interface RelationViewLabels {
  actor(ref: ActorRef): ActorSummary
  source(kind: ActorInteractionKind, sourceId: string): { label: string; href: string | null }
}

const refKey = (r: ActorRef): string => `${r.kind}:${r.id}`
const dayIso = (d: Date): string => d.toISOString().slice(0, 10)

/** Nature dominante de la relation (aujourd'hui mono-signal par couple). */
function primaryType(breakdown: Record<ActorInteractionKind, { rawStrength: number }>): ActorInteractionKind {
  const order: ActorInteractionKind[] = ['co_action', 'co_casting', 'co_team']
  return order.reduce((best, k) => (breakdown[k].rawStrength > breakdown[best].rawStrength ? k : best), order[0]!)
}

/** Tri : force décroissante, puis activité courante, puis récence, puis id stable. */
function compareViews(a: ActorRelationView, b: ActorRelationView): number {
  if (a.strength !== b.strength) return b.strength - a.strength
  if (a.activity.current !== b.activity.current) return b.activity.current - a.activity.current
  if (a.daysSinceLastInteraction !== b.daysSinceLastInteraction) return a.daysSinceLastInteraction - b.daysSinceLastInteraction
  const ka = refKey(a.actor), kb = refKey(b.actor)
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

/** Toutes les relations d'un acteur, triées et expliquées. Filtre aux couples
 *  contenant `self` (aucune transitivité). N'altère pas l'entrée. */
export function buildActorRelationViews(
  self: ActorRef, interactions: ActorInteraction[], asOf: Date, labels: RelationViewLabels,
): ActorRelationView[] {
  const asOfDay = dayIso(asOf)
  const selfKey = refKey(self)

  // Regroupe les faits par acteur LIÉ (l'autre extrémité du couple contenant self).
  const byOther = new Map<string, { other: ActorRef; facts: ActorInteraction[] }>()
  for (const i of interactions) {
    const aK = refKey(i.actorA), bK = refKey(i.actorB)
    if (aK !== selfKey && bK !== selfKey) continue // interaction ne concernant pas self
    const other = aK === selfKey ? i.actorB : i.actorA
    const k = refKey(other)
    if (!byOther.has(k)) byOther.set(k, { other, facts: [] })
    byOther.get(k)!.facts.push(i)
  }

  const views: ActorRelationView[] = []
  for (const { other, facts } of byOther.values()) {
    const relation = aggregateActorRelations(facts, asOf)[0]!
    const temporal = computeRelationTemporalMetrics(facts, asOf)

    const explanation: ActorRelationExplanationItem[] = relation.contributions.map((c) => {
      const src = labels.source(c.interactionType, c.sourceId)
      const activeTo = c.activeTo ?? null
      const isActive = c.interactionType !== 'co_action' && (activeTo == null || activeTo >= asOfDay)
      return {
        interactionType: c.interactionType,
        sourceId: c.sourceId,
        sourceLabel: src.label,
        sourceHref: src.href,
        observedAt: c.interactionType === 'co_action' ? c.referenceDate : null,
        activeFrom: c.activeFrom ?? null,
        activeTo,
        isActive,
        rawContribution: c.rawWeight,
        currentContribution: c.weightedContribution,
      }
    })

    views.push({
      actor: labels.actor(other),
      relationType: primaryType(relation.breakdown),
      rawStrength: relation.rawStrength,
      strength: relation.rawStrength, // pas de normalisation à ce stade
      activity: {
        current: temporal.activity.current.contribution,
        previous: temporal.activity.previous.contribution,
        delta: temporal.activity.delta,
        trend: temporal.activity.trend,
      },
      strengthEvolution: {
        current: temporal.strengthEvolution.current,
        previous: temporal.strengthEvolution.previous,
        delta: temporal.strengthEvolution.delta,
      },
      daysSinceLastInteraction: temporal.daysSinceLastInteraction,
      activeInteractionCount: relation.activeInteractionCount,
      interactionCount: relation.interactionCount,
      explanation,
    })
  }

  views.sort(compareViews)
  return views
}

/** Les N relations les plus fortes (après tri) — « Travaille principalement avec ». */
export function topRelations(views: ActorRelationView[], n = 5): ActorRelationView[] {
  return views.slice(0, n)
}

/** Regroupement compact pour l'écosystème (sans qualificatif ni seuil arbitraire). */
export function groupEcosystem(views: ActorRelationView[]): ActorEcosystem {
  return {
    principal: views, // déjà triées par force ; l'UI n'en montre que les premières
    recent: views.filter((v) => v.activity.trend === 'new' || v.activity.trend === 'increasing'),
    inactive: views.filter((v) => v.activity.trend === 'inactive'),
  }
}

/** Traduction UI d'une tendance — `null` pour insufficient_data (aucun qualificatif). */
export function trendUiLabel(trend: ActorRelationTrend): string | null {
  switch (trend) {
    case 'new': return 'Nouvelle collaboration'
    case 'increasing': return 'Activité en hausse'
    case 'stable': return 'Activité stable'
    case 'decreasing': return 'Activité en baisse'
    case 'inactive': return 'Collaboration inactive'
    case 'insufficient_data': return null
  }
}
