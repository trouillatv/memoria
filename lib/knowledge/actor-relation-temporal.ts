// ── DIMENSIONS TEMPORELLES D'UNE RELATION (V3, étape 4) ──────────────────────
// PUR & déterministe : enrichit une relation (les faits d'UN couple canonique) de
// lectures temporelles. Trois sorties SÉPARÉES, jamais fusionnées :
//   1. indicateurs factuels (âge, récence, activité par fenêtre) ;
//   2. évolution MÉCANIQUE de la force récencée (peut baisser par simple décote) ;
//   3. tendance d'activité PRUDENTE (fondée sur les événements observés).
//
// Distinctions essentielles (Vincent) :
//   · absence de nouvel événement ≠ dégradation démontrée ;
//   · une durée (co_casting/co_team) encore active reste une activité structurelle,
//     jamais « en baisse » faute de nouveau casting ;
//   · une baisse de la force récencée peut n'être QUE de la décote — ne jamais la
//     convertir en tendance métier.
//
// Note d'architecture (réserve Vincent) : l'étape 3 pose `lastInteractionAt = asOf`
// pour une durée active (= dernière date de RÉFÉRENCE du score, pas un événement).
// Ici on calcule des dates OBSERVÉES distinctes — `lastInteractionAt` ci-dessous est
// le dernier événement réellement observé (`lastObservedEventAt`), à ne jamais lire
// comme la preuve qu'un événement s'est produit aujourd'hui. La récence effective
// (relation active → 0) est portée SÉPARÉMENT par `daysSinceLastInteraction`.

import { aggregateActorRelations, INTERACTION_WEIGHTS } from './actor-relations'
import type { ActorInteraction } from './actor-interactions'

/** Durée d'une fenêtre d'activité (jours). Centralisée — ne jamais disperser « 90 ». */
export const RELATION_ACTIVITY_WINDOW_DAYS = 90
/** En dessous de ce poids d'activité cumulé, une comparaison n'est pas significative. */
export const MIN_COMPARABLE_ACTIVITY_WEIGHT = 4
export const INCREASING_ACTIVITY_RATIO = 1.5
export const DECREASING_ACTIVITY_RATIO = 0.67

export type RelationActivityTrend =
  | 'increasing' | 'stable' | 'decreasing' | 'new' | 'inactive' | 'insufficient_data'

export interface RelationWindowMetrics {
  eventCount: number            // occurrences ponctuelles (co_action) datées dans la fenêtre
  activeDurationCount: number   // durées (co_casting/co_team) chevauchant la fenêtre
  contribution: number          // poids par fenêtre, SANS décote de récence (in/out binaire)
}

export interface RelationTemporalMetrics {
  /** Date OBSERVÉE la plus ancienne (début réel), pas la date de référence du score. */
  firstInteractionAt: string
  /** Dernier événement OBSERVÉ (lastObservedEventAt) — pas une preuve d'activité ce jour. */
  lastInteractionAt: string
  ageInDays: number
  daysSinceLastInteraction: number
  activity: {
    windowDays: number
    current: RelationWindowMetrics
    previous: RelationWindowMetrics
    delta: number
    ratio: number | null
    trend: RelationActivityTrend
  }
  strengthEvolution: { current: number; previous: number; delta: number; ratio: number | null }
}

const DAY = 86_400_000
const utcMidnight = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
const dayNum = (iso: string): number => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY)
const asOfNum = (d: Date): number => Math.floor(utcMidnight(d) / DAY)
const isoOfNum = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10)

const isDuration = (i: ActorInteraction): boolean => i.kind === 'co_casting' || i.kind === 'co_team'
/** Début observé d'un fait (occurrence ou début d'intervalle). */
const startNum = (i: ActorInteraction): number => dayNum(isDuration(i) ? i.activeFrom! : i.occurredAt)
/** Fin observée d'un fait : occurrence = sa date ; intervalle = sa fin, sinon son début. */
const observedEndNum = (i: ActorInteraction): number =>
  i.kind === 'co_action' ? dayNum(i.occurredAt) : (i.activeTo ? dayNum(i.activeTo) : dayNum(i.activeFrom!))

/** Fenêtre demi-ouverte (lo, hi]. Un événement/une durée ne peut appartenir aux deux
 *  fenêtres consécutives grâce à cette convention (borne haute inclusive). */
function windowMetrics(interactions: ActorInteraction[], lo: number, hi: number): RelationWindowMetrics {
  let eventCount = 0, activeDurationCount = 0, contribution = 0
  for (const i of interactions) {
    if (i.kind === 'co_action') {
      const n = dayNum(i.occurredAt)
      if (n > lo && n <= hi) { eventCount += 1; contribution += INTERACTION_WEIGHTS.co_action } // in/out binaire
    } else {
      const from = dayNum(i.activeFrom!)
      const to = i.activeTo ? dayNum(i.activeTo) : null
      // Chevauchement réel : commence avant la fin de fenêtre ET finit après son début.
      // Une durée longue compte UNE fois par fenêtre (pas d'intensité journalière).
      if (from <= hi && (to == null || to > lo)) { activeDurationCount += 1; contribution += INTERACTION_WEIGHTS[i.kind] }
    }
  }
  return { eventCount, activeDurationCount, contribution }
}

function activityTrend(current: number, previous: number): RelationActivityTrend {
  if (previous === 0 && current > 0) return 'new'                    // activité nouvelle dans les fenêtres
  if (previous === 0 && current === 0) return 'inactive'            // aucune activité récente (historique existe)
  if (current + previous < MIN_COMPARABLE_ACTIVITY_WEIGHT) return 'insufficient_data'
  const ratio = current / previous                                  // previous > 0 ici
  if (ratio >= INCREASING_ACTIVITY_RATIO) return 'increasing'
  if (ratio <= DECREASING_ACTIVITY_RATIO) return 'decreasing'
  return 'stable'
}

/** Force récencée (étape 3) d'un couple à une date — 0 si aucun fait. */
function strengthAt(interactions: ActorInteraction[], asOf: Date): number {
  if (interactions.length === 0) return 0
  const rs = aggregateActorRelations(interactions, asOf)
  return rs.length ? rs[0]!.rawStrength : 0
}

/** Métriques temporelles d'UNE relation (les faits d'un seul couple canonique).
 *  `asOf` injecté ; toutes les fenêtres lui sont relatives. N'altère pas l'entrée. */
export function computeRelationTemporalMetrics(interactions: ActorInteraction[], asOf: Date): RelationTemporalMetrics {
  const asOfN = asOfNum(asOf)
  const curLo = asOfN - RELATION_ACTIVITY_WINDOW_DAYS, curHi = asOfN
  const prevLo = asOfN - 2 * RELATION_ACTIVITY_WINDOW_DAYS, prevHi = asOfN - RELATION_ACTIVITY_WINDOW_DAYS

  // ── Dates OBSERVÉES (historiques, indépendantes de la référence du score) ──
  const starts = interactions.map(startNum)
  const ends = interactions.map(observedEndNum)
  const firstN = starts.reduce((m, n) => (n < m ? n : m), starts[0] ?? asOfN)
  const lastN = ends.reduce((m, n) => (n > m ? n : m), ends[0] ?? asOfN)
  const active = interactions.some((i) => isDuration(i) && (i.activeTo == null || dayNum(i.activeTo) >= asOfN))

  // ── Activité par fenêtre (ponctuel vs structurel séparés, jamais additionnés en douce) ──
  const current = windowMetrics(interactions, curLo, curHi)
  const previous = windowMetrics(interactions, prevLo, prevHi)
  const delta = current.contribution - previous.contribution
  const ratio = previous.contribution > 0 ? current.contribution / previous.contribution : null
  const trend = activityTrend(current.contribution, previous.contribution)

  // ── Évolution MÉCANIQUE de la force récencée (le passé n'utilise aucun fait futur) ──
  const previousAsOf = new Date((asOfN - RELATION_ACTIVITY_WINDOW_DAYS) * DAY)
  const prevAsOfN = asOfN - RELATION_ACTIVITY_WINDOW_DAYS
  const existedAtPrev = interactions.filter((i) => startNum(i) <= prevAsOfN) // exclut ce qui n'existait pas encore
  const currentStrength = strengthAt(interactions, asOf)
  const previousStrength = strengthAt(existedAtPrev, previousAsOf)

  return {
    firstInteractionAt: isoOfNum(firstN),
    lastInteractionAt: isoOfNum(lastN),
    ageInDays: Math.max(0, asOfN - firstN),
    daysSinceLastInteraction: active ? 0 : Math.max(0, asOfN - lastN),
    activity: { windowDays: RELATION_ACTIVITY_WINDOW_DAYS, current, previous, delta, ratio, trend },
    strengthEvolution: {
      current: currentStrength,
      previous: previousStrength,
      delta: currentStrength - previousStrength,
      ratio: previousStrength > 0 ? currentStrength / previousStrength : null,
    },
  }
}
