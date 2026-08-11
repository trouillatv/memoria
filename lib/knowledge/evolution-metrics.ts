// Moteur Évolution V1 — calcul déterministe des métriques de changement significatif.
//
// Critères V1 (déterministes uniquement) :
//   1. Changement de visitStatus ou documentStatus entre deux événements métier distincts.
//   2. (V1B, PDF uniquement) Apparition d'un nouvel objet métier matérialisé lié au run.
//
// Règle fondamentale : plusieurs preuves le même jour ≠ plusieurs événements métier.
// La clé d'événement est sourceKind + effectiveDate (même visite = même événement).
//
// Ce module est pur (pas de DB, pas d'IA). Il peut être testé directement avec vitest.

export interface NativeOccurrence {
  sourceKind: string
  effectiveDate: string
  visitStatus: string | null
  documentStatus: string | null
}

export interface MeaningfulChangeMetrics {
  /** Date ISO de la dernière occurrence qui a modifié la signature métier. */
  lastMeaningfulChangeAt: string | null
  /** Nombre d'événements consécutifs sans changement détecté depuis lastMeaningfulChangeAt. */
  consecutiveMentionsWithoutChange: number
  /** Jours entre lastMeaningfulChangeAt et lastSeenAt (0 si identiques ou si LMCA est null). */
  stagnationDays: number
  /** Vrai si stagnationDays >= 30 ET consecutiveMentionsWithoutChange >= 2. */
  isStagnant: boolean
}

/**
 * Calcule les métriques de changement significatif à partir d'une liste d'occurrences
 * terrain ou réunion (déjà filtrées — pas de gaps, triées chronologiquement).
 *
 * Plusieurs preuves sur le même événement (sourceKind + date) sont fusionnées :
 * on retient le premier statut non-null rencontré (visitStatus prioritaire, puis documentStatus).
 *
 * Limites V1 assumées :
 * - Si toutes les occurrences ont un statut null → une seule "phase neutre" → LMCA = première date.
 * - Les nuances sémantiques entre preuves d'un même événement ne sont pas détectées.
 *   Le moteur LLM prendra le relais en V2+.
 */
export function computeNativeChangeMetrics(
  occs: NativeOccurrence[],
  lastSeenAt: string | null,
): MeaningfulChangeMetrics {
  if (occs.length === 0) {
    return { lastMeaningfulChangeAt: null, consecutiveMentionsWithoutChange: 0, stagnationDays: 0, isStagnant: false }
  }

  // 1. Construire la liste d'événements ordonnés (une entrée par sourceKind+date).
  //    L'ordre d'insertion dans Map = ordre d'itération sur occs = ordre chronologique.
  type Event = { date: string; status: string | null }
  const eventMap = new Map<string, Event>()

  for (const occ of occs) {
    const key = `${occ.sourceKind}\x00${occ.effectiveDate}` // \x00 comme séparateur sans ambiguïté
    const existing = eventMap.get(key)
    if (!existing) {
      eventMap.set(key, { date: occ.effectiveDate, status: occ.visitStatus ?? occ.documentStatus ?? null })
    } else if (existing.status === null) {
      const st = occ.visitStatus ?? occ.documentStatus ?? null
      if (st !== null) existing.status = st
    }
  }

  const events = [...eventMap.values()]

  // 2. Détecter les changements de statut entre événements.
  let lastMeaningfulChangeAt: string | null = null
  let lastKnownStatus: string | null | undefined = undefined
  let consecutiveMentionsWithoutChange = 0

  for (const { date, status } of events) {
    if (lastKnownStatus === undefined || status !== lastKnownStatus) {
      lastMeaningfulChangeAt = date
      lastKnownStatus = status
      consecutiveMentionsWithoutChange = 0
    } else {
      consecutiveMentionsWithoutChange++
    }
  }

  // 3. Stagnation
  const stagnationDays =
    lastMeaningfulChangeAt && lastSeenAt && lastMeaningfulChangeAt !== lastSeenAt
      ? Math.floor(
          (new Date(lastSeenAt).getTime() - new Date(lastMeaningfulChangeAt).getTime()) / 86_400_000,
        )
      : 0

  const isStagnant = stagnationDays >= 30 && consecutiveMentionsWithoutChange >= 2

  return { lastMeaningfulChangeAt, consecutiveMentionsWithoutChange, stagnationDays, isStagnant }
}
