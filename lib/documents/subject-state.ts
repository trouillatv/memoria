// Moteur d'état longitudinal des canonical_subject — P1-3B
//
// Implémente la doctrine P1-3A :
//   - Tri-state : open | resolved | unknown
//   - unknown est un état de connaissance réel (absence de preuve ≠ open)
//   - Moteur de transition unifié, gap-aware
//   - D1 corrigé : resolved → gap → open = REOPEN (jamais REAPPEARANCE)
//
// Sources : docs/memory-longitudinal-v1/P1-3A-CANONICAL-STATE-MODEL.md

// ── Types ─────────────────────────────────────────────────────────────────────

/** État de connaissance du sujet canonique à la fin d'un PV donné. */
export type PvState = 'open' | 'resolved' | 'unknown'

/**
 * Transition longitudinale entre deux états connus du sujet.
 * NOT_MENTIONED est calculé côté appelant quand le sujet est absent du PV.
 */
export type SubjectTransition =
  | 'CONTINUATION'          // sujet toujours ouvert, signal présent
  | 'REPEAT_WITHOUT_CHANGE' // aucun changement observable
  | 'REAPPEARANCE'          // retour après gap, sans résolution antérieure
  | 'REOPEN'                // avait été résolu, redevient actif
  | 'NEW_CYCLE'             // nouvel épisode (deadline récurrente, label daté)
  | 'RESOLVED'              // passe de non-résolu à résolu
  | 'NOT_MENTIONED'         // absent du PV courant (calculé, jamais stocké)

// ── Fonctions pures ───────────────────────────────────────────────────────────

/**
 * Mappe un document_status brut vers l'état tri-state.
 *
 * Règle : null ou toute valeur non reconnue → unknown.
 * Ne fabrique jamais open ou resolved à partir d'une absence de signal.
 */
export function documentStatusToPvState(status: string | null): PvState {
  if (status === null) return 'unknown'
  if (status === 'done' || status === 'cancelled' || status === 'informational') return 'resolved'
  if (
    status === 'open' ||
    status === 'in_progress' ||
    status === 'planned' ||
    status === 'non_compliant' ||
    status === 'awaiting_validation'
  ) return 'open'
  return 'unknown'
}

/**
 * Agrège plusieurs statuts de propositions en un seul PvState.
 *
 * Hiérarchie de force : resolved > open > unknown.
 * Le signal le plus fort l'emporte — jamais un fallback null → open.
 */
export function aggregatePvState(statuses: (string | null)[]): PvState {
  let result: PvState = 'unknown'
  for (const status of statuses) {
    const state = documentStatusToPvState(status)
    if (state === 'resolved') return 'resolved' // court-circuit : maximum atteint
    if (state === 'open') result = 'open'
  }
  return result
}

/**
 * Moteur de transition longitudinal unifié.
 *
 * Hiérarchie d'évaluation (table de vérité P1-3A §6) :
 *   1. NEW_CYCLE
 *   2. REOPEN  — prevResolved=true && currSignal=open (avec ou sans gap)
 *   3. REAPPEARANCE — gap && prevResolved≠true && currSignal≠resolved
 *   4. RESOLVED — pas de gap && currSignal=resolved && prevResolved≠true
 *   5. REPEAT_WITHOUT_CHANGE — resolved maintenu ou unknown sans changement
 *   6. CONTINUATION / REPEAT selon la signature
 *
 * prevResolved = null signifie "aucun état antérieur connu" (première occurrence
 * ou séquence entièrement unknown jusqu'ici). Traité comme false pour REOPEN/REAPPEARANCE.
 */
export function computeSubjectTransition({
  prevResolved,
  hasGap,
  currSignal,
  isNewCycle,
}: {
  prevResolved: boolean | null
  hasGap: boolean
  currSignal: PvState
  isNewCycle: boolean
}): SubjectTransition {
  // 1. NEW_CYCLE l'emporte toujours
  if (isNewCycle) return 'NEW_CYCLE'

  // 2. REOPEN : était résolu, redevient actif (avec ou sans gap — correction D1)
  if (prevResolved === true && currSignal === 'open') return 'REOPEN'

  // 3. REAPPEARANCE : gap, pas de résolution antérieure, retour quelconque
  if (hasGap && prevResolved !== true && currSignal !== 'resolved') return 'REAPPEARANCE'

  // 4. RESOLVED : nouveaux signal résolu (gap traité par cas résolu→gap→résolu = REPEAT)
  if (prevResolved !== true && currSignal === 'resolved') return 'RESOLVED'

  // 5. REPEAT sans changement : résolu maintenu, ou unknown sans évidence
  if (prevResolved === true && currSignal !== 'open') return 'REPEAT_WITHOUT_CHANGE'
  if (currSignal === 'unknown') return 'REPEAT_WITHOUT_CHANGE'

  // 6. Signal open, pas résolu avant, pas de gap → signature à comparer côté appelant
  return 'CONTINUATION'
}

/**
 * Dérive le dernier état de résolution connu depuis une chronologie d'états.
 *
 * Ignore les unknown : un unknown intermédiaire ne réinitialise pas l'état antérieur.
 * Retourne null si tous les états sont unknown (aucun signal fiable jamais vu).
 */
export function deriveCurrentResolvedState(states: PvState[]): boolean | null {
  for (let i = states.length - 1; i >= 0; i--) {
    const s = states[i]
    if (s === 'resolved') return true
    if (s === 'open') return false
  }
  return null
}

/**
 * Mappe un visit_status brut vers l'état tri-state.
 *
 * field_checked/mentioned = signal de passage, jamais de résolution → unknown.
 * still_open = non résolu explicitement → open.
 * not_applicable = résolution par inapplicabilité → resolved.
 * Toute valeur non reconnue → unknown (conservatif).
 */
export function visitStatusToPvState(status: string | null): PvState {
  if (status === null) return 'unknown'
  if (status === 'still_open') return 'open'
  if (status === 'not_applicable') return 'resolved'
  return 'unknown'
}

/** Occurrence unifiée pour le calcul de lastMeaningfulChangeAt. */
export interface LmcaOccurrence {
  effectiveDate: string
  /** État tri-state projeté depuis le statut source (documentStatus ou visitStatus). */
  pvState: PvState
  /** Signature des objets matérialisés dans ce run ('' = aucun / occurrence terrain native). */
  objectSig: string
}

/**
 * Calcule lastMeaningfulChangeAt depuis une timeline d'occurrences pré-projetées.
 *
 * Niveau 1 — transitions P1-3 (RESOLVED/REOPEN uniquement) :
 *   - Première occurrence : baseline inconditionnelle.
 *   - RESOLVED (lastNonUnknown=open → curr=resolved) et REOPEN (resolved → open) seulement.
 *   - unknown ne met pas à jour lastNonUnknownState.
 *   - unknown→open : conservativement non significatif (indistingable d'un meilleur signal).
 *
 * Niveau 2 — objets matérialisés : objectSig non vide et différent du précédent.
 */
export function computeLmcaFromOccurrences(
  occs: LmcaOccurrence[],
): { lastMeaningfulChangeAt: string | null; consecutiveMentionsWithoutChange: number } {
  if (occs.length === 0) return { lastMeaningfulChangeAt: null, consecutiveMentionsWithoutChange: 0 }

  let lastMeaningfulChangeAt: string | null = null
  let lastNonUnknownState: PvState | null = null
  let lastObjectSig: string | null = null
  let consecutiveMentionsWithoutChange = 0

  for (const occ of occs) {
    let meaningful = false

    if (lastMeaningfulChangeAt === null) {
      meaningful = true
    } else {
      // Niveau 1 : seulement RESOLVED (open→resolved) et REOPEN (resolved→open)
      if (occ.pvState !== 'unknown' && lastNonUnknownState !== null) {
        if (occ.pvState === 'resolved' && lastNonUnknownState === 'open') meaningful = true
        else if (occ.pvState === 'open' && lastNonUnknownState === 'resolved') meaningful = true
      }
      // Niveau 2 : changement d'objets matérialisés
      if (occ.objectSig !== '' && occ.objectSig !== lastObjectSig) meaningful = true
    }

    if (meaningful) {
      lastMeaningfulChangeAt = occ.effectiveDate
      consecutiveMentionsWithoutChange = 0
    } else {
      consecutiveMentionsWithoutChange++
    }

    if (occ.pvState !== 'unknown') lastNonUnknownState = occ.pvState
    if (occ.objectSig !== '') lastObjectSig = occ.objectSig
  }

  return { lastMeaningfulChangeAt, consecutiveMentionsWithoutChange }
}
