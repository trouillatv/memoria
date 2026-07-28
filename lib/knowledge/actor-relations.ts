// ── AGRÉGATION EN FORCE DE RELATION (V3, étape 3) ────────────────────────────
// PUR & déterministe : transforme la collection de faits `ActorInteraction`
// (étape 2) en une relation agrégée PAR COUPLE canonique. Strictement dérivé des
// faits — aucune nouvelle requête, aucune inférence, aucune transitivité.
//
// Le résultat est un SCORE BRUT récencé + son DÉTAIL entièrement recalculable.
// PAS de normalisation, PAS de plafond, PAS de log, PAS de qualificatif
// (« forte »/« proche »…) : ces choix viendront après observation des
// distributions réelles (cf. cadrage §11). La date de calcul `asOf` est INJECTÉE
// — jamais de `new Date()` implicite ici.

import type { ActorInteraction, ActorInteractionKind, ActorRef } from './actor-interactions'

/** Coefficients PRODUIT versionnés (V1) — une convention, pas une vérité stockée
 *  dans les faits. Centralisés : ne jamais disperser ces nombres dans le code. */
export const INTERACTION_WEIGHTS: Record<ActorInteractionKind, number> = {
  co_action: 3,
  co_casting: 2,
  co_team: 2,
}

export interface RelationContribution {
  interactionType: ActorInteractionKind
  sourceType: string
  sourceId: string
  /** Date de référence utilisée pour la récence (voir referenceDateOf). */
  referenceDate: string
  rawWeight: number
  recencyFactor: number
  weightedContribution: number
  activeFrom?: string
  activeTo?: string | null
}

export interface RelationBreakdownEntry { count: number; rawStrength: number }

export interface AggregatedActorRelation {
  actorA: ActorRef
  actorB: ActorRef
  rawStrength: number
  interactionCount: number
  firstInteractionAt: string
  lastInteractionAt: string
  /** Faits de DURÉE encore actifs à `asOf` (une co_action ponctuelle ne l'est jamais). */
  activeInteractionCount: number
  breakdown: Record<ActorInteractionKind, RelationBreakdownEntry>
  contributions: RelationContribution[]
}

const refKey = (r: ActorRef): string => `${r.kind}:${r.id}`
const dayIso = (d: Date): string => d.toISOString().slice(0, 10)
const utcMidnight = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

/** Décote de récence V1 : simple, lisible, auditable. Une date future ou égale à
 *  `asOf` vaut 1 ; une interaction ancienne ne tombe jamais à zéro. */
export function getRecencyFactor(referenceDate: Date, asOf: Date): number {
  const ageInDays = Math.round((utcMidnight(asOf) - utcMidnight(referenceDate)) / 86_400_000)
  if (ageInDays <= 90) return 1
  if (ageInDays <= 365) return 0.75
  if (ageInDays <= 730) return 0.5
  return 0.25
}

/** Date de référence d'un fait pour la récence :
 *  · co_action (ponctuel) → occurredAt ;
 *  · co_casting / co_team → asOf si la période est ENCORE ACTIVE à asOf, sinon
 *    activeTo (fin réelle). Jamais activeFrom : une collaboration commencée il y a
 *    3 ans mais toujours active reste récente. */
function referenceDateOf(i: ActorInteraction, asOfDay: string): { ref: string; active: boolean } {
  if (i.kind === 'co_action') return { ref: i.occurredAt.slice(0, 10), active: false }
  const to = i.activeTo ?? null
  const active = to == null || to >= asOfDay
  return { ref: active ? asOfDay : to, active }
}

/** Agrège les faits en relations par couple. `asOf` = date de calcul (injectée). */
export function aggregateActorRelations(interactions: ActorInteraction[], asOf: Date): AggregatedActorRelation[] {
  const asOfDay = dayIso(asOf)
  const byPair = new Map<string, ActorInteraction[]>()
  for (const i of interactions) {
    const key = `${refKey(i.actorA)}|${refKey(i.actorB)}` // couple DÉJÀ canonique (étape 2)
    if (!byPair.has(key)) byPair.set(key, [])
    byPair.get(key)!.push(i)
  }

  const relations: AggregatedActorRelation[] = []
  for (const [, facts] of byPair) {
    const contributions: RelationContribution[] = []
    const breakdown: Record<ActorInteractionKind, RelationBreakdownEntry> = {
      co_action: { count: 0, rawStrength: 0 },
      co_casting: { count: 0, rawStrength: 0 },
      co_team: { count: 0, rawStrength: 0 },
    }
    let rawStrength = 0
    let activeInteractionCount = 0

    for (const f of facts) {
      const { ref, active } = referenceDateOf(f, asOfDay)
      const rawWeight = INTERACTION_WEIGHTS[f.kind]
      const recencyFactor = getRecencyFactor(new Date(`${ref}T00:00:00Z`), asOf)
      const weightedContribution = rawWeight * recencyFactor // jamais arrondi
      contributions.push({
        interactionType: f.kind, sourceType: f.sourceType, sourceId: f.sourceId,
        referenceDate: ref, rawWeight, recencyFactor, weightedContribution,
        activeFrom: f.activeFrom, activeTo: f.activeTo,
      })
      rawStrength += weightedContribution
      breakdown[f.kind].count += 1
      breakdown[f.kind].rawStrength += weightedContribution
      if (active) activeInteractionCount += 1
    }

    // Tri déterministe (le résultat ne dépend pas de l'ordre d'entrée).
    contributions.sort((a, b) =>
      a.referenceDate < b.referenceDate ? -1 : a.referenceDate > b.referenceDate ? 1
        : a.interactionType < b.interactionType ? -1 : a.interactionType > b.interactionType ? 1
          : a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)
    const refDates = contributions.map((c) => c.referenceDate)

    relations.push({
      actorA: facts[0]!.actorA, actorB: facts[0]!.actorB,
      rawStrength, interactionCount: facts.length,
      firstInteractionAt: refDates.reduce((m, d) => (d < m ? d : m), refDates[0]!),
      lastInteractionAt: refDates.reduce((m, d) => (d > m ? d : m), refDates[0]!),
      activeInteractionCount, breakdown, contributions,
    })
  }

  // Ordre stable des relations (par couple).
  relations.sort((x, y) => {
    const kx = `${refKey(x.actorA)}|${refKey(x.actorB)}`, ky = `${refKey(y.actorA)}|${refKey(y.actorB)}`
    return kx < ky ? -1 : kx > ky ? 1 : 0
  })
  return relations
}
