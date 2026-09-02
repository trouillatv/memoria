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
 * P0-1 — État d'un sujet dans UN document pour la tension : 'resolved' UNIQUEMENT si TOUS ses états y
 * sont prouvés résolus ; sinon 'open' (mentionné sans preuve de résolution = concern ouvert).
 */
export function runTensionState(stateStatuses: (string | null)[]): 'open' | 'resolved' {
  return stateStatuses.length > 0 && stateStatuses.every((s) => s === 'resolved') ? 'resolved' : 'open'
}

/**
 * P0-1 — Trajectoire de tension d'un sujet : pour chaque document (dans l'ordre chronologique), le sujet
 * est-il ACTIF ? Doctrine non-mention ≠ résolu : le dernier état PROUVÉ est REPORTÉ (carry-forward) ; une
 * non-mention (`null`) ne change rien. La tension ne baisse donc QUE sur une résolution prouvée.
 * `isNew` = première apparition active. `perRun[i]` = 'open' | 'resolved' | null (null = non mentionné).
 */
export function tensionTrajectory(perRun: ('open' | 'resolved' | null)[]): { active: boolean; isNew: boolean }[] {
  let carried: 'open' | 'resolved' | null = null
  return perRun.map((rs) => {
    let isNew = false
    if (rs !== null) {
      if (carried === null && rs === 'open') isNew = true
      carried = rs
    }
    return { active: carried === 'open', isNew }
  })
}

/** Raison du tri-state d'une occurrence : état univoque, absence d'information, ou conflit interne. */
export type StateStatusReason = 'univocal' | 'missing' | 'conflict'

/**
 * R-1 — statut tri-state d'UNE occurrence atomique (un groupe state_key = un état).
 *
 * Contraste volontaire avec `aggregatePvState` : ici, le conflit n'est PAS masqué. Si les
 * propositions poolées dans l'occurrence portent à la fois du resolved ET du open, le système
 * REFUSE de trancher → `unknown` (reason `conflict`), jamais une priorité open>resolved ni
 * resolved>open qui transformerait une ambiguïté en certitude (contamination LMCA/attention/récit).
 *
 * - resolved seul (aucun open)              → resolved (univocal)
 * - open seul (aucun resolved)              → open (univocal)
 * - resolved ET open dans le même groupe    → unknown (conflict) — observable, jamais fabriqué
 * - aucun signal exploitable (tout null)    → unknown (missing)
 *
 * `reason` distingue `missing` de `conflict` pour le diagnostic (logs/audits), sans colonne dédiée.
 */
export function deriveOccurrenceStateStatus(
  statuses: (string | null)[],
): { status: PvState; reason: StateStatusReason } {
  return deriveOccurrenceFromPvStates(statuses.map(documentStatusToPvState))
}

/**
 * E2 — projection d'un VERDICT NORMALISÉ (couche E1, `source_payload.verdict`)
 * vers le tri-state longitudinal. Ne projette QUE ce qui constitue une PREUVE
 * D'ÉTAT exploitable ; tout le reste reste `unknown` (le carry-forward du moteur
 * longitudinal protège alors le dernier état prouvé).
 *
 * Doctrine (Vincent, E2) :
 *   lifecycle_done                                   → resolved (clôture prouvée)
 *   lifecycle_open | in_progress | planned           → open (tâche non soldée)
 *   compliant_negative (NC)                          → open (problème prouvé actif)
 *   unverified | not_applicable | pending_control    → unknown (aucune preuve exploitable)
 *   compliant_positive (« conforme »)                → unknown — STRICT : une conformité
 *     positive datée n'est PAS une preuve de tâche terminée ; ne jamais recréer le
 *     raccourci « conforme = résolu » (question renvoyée à E4). Évite aussi un faux
 *     resolved→open si le sujet redevient NC plus tard.
 *   null / valeur non reconnue                       → unknown
 */
export function verdictNormalizedToPvState(normalized: string | null | undefined): PvState {
  switch (normalized) {
    case 'lifecycle_done':
      return 'resolved'
    case 'lifecycle_open':
    case 'lifecycle_in_progress':
    case 'lifecycle_planned':
    case 'compliant_negative':
      return 'open'
    // unverified | not_applicable | pending_control | compliant_positive | null → unknown
    default:
      return 'unknown'
  }
}

/**
 * Cœur d'agrégation conflit-aware d'une occurrence, sur des PvState déjà résolus.
 * Même doctrine que `deriveOccurrenceStateStatus` (resolved ET open → unknown
 * conflict, jamais masqué), mais indépendante de la SOURCE du PvState (verdict
 * normalisé E2 ou document_status legacy).
 */
export function deriveOccurrenceFromPvStates(
  pvStates: PvState[],
): { status: PvState; reason: StateStatusReason } {
  let hasResolved = false
  let hasOpen = false
  for (const st of pvStates) {
    if (st === 'resolved') hasResolved = true
    else if (st === 'open') hasOpen = true
  }
  if (hasResolved && hasOpen) return { status: 'unknown', reason: 'conflict' }
  if (hasResolved) return { status: 'resolved', reason: 'univocal' }
  if (hasOpen) return { status: 'open', reason: 'univocal' }
  return { status: 'unknown', reason: 'missing' }
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
 * Un sujet est "prouvé ouvert" si son dernier état connu est open,
 * ou s'il possède au moins un objet terrain actif (action/échéance).
 *
 * Garde critique : field_checked sans objet actif → false.
 * Sur les chantiers 100 % terrain (PETRO), le tri-state est toujours 'unknown' ;
 * seul un objet actif constitue une preuve d'ouverture.
 */
export function isProvenOpen(currentTriState: PvState, activeObjectsTotal: number): boolean {
  return currentTriState === 'open' || activeObjectsTotal > 0
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
 * P3-D1 — Effondre une timeline d'occurrences par DATE avant le calcul LMCA.
 *
 * Avec la multiplicité atomique (plusieurs occurrences/états d'un sujet dans un même document, même
 * effective_date), le calcul LMCA doit voir UN point par document — sinon deux états du même PV
 * (ex. « réalisé » + « à refaire ») fabriqueraient un changement intra-document, et l'ordre non
 * déterministe des ex-æquo rendrait le résultat instable.
 *
 * Effondrement déterministe et commutatif : pvState agrégé (resolved>open>unknown, indépendant de
 * l'ordre) ; objectSig = union triée. NO-OP pour les données mono-occurrence existantes (une seule
 * occurrence par date → renvoyée telle quelle). event_date distincte = hors D1 (traité en D2).
 */
export function collapseLmcaOccurrencesByDate(occs: LmcaOccurrence[]): LmcaOccurrence[] {
  // Agrégation de PvState DÉJÀ projetés (pas des statuts bruts) : resolved > open > unknown.
  // Cette hiérarchie reproduit le comportement de l'ancien modèle poolé (aggregatePvState court-
  // circuitait sur resolved) → D1 ne change PAS la sémantique LMCA, il la rend seulement stable
  // sous multiplicité. La distinction temporelle réalisé→à refaire relève de D2 (event_date).
  const rank = (s: PvState): number => (s === 'resolved' ? 2 : s === 'open' ? 1 : 0)
  const byDate = new Map<string, { state: PvState; sigs: Set<string> }>()
  const order: string[] = []
  for (const o of occs) {
    if (!byDate.has(o.effectiveDate)) { byDate.set(o.effectiveDate, { state: 'unknown', sigs: new Set() }); order.push(o.effectiveDate) }
    const e = byDate.get(o.effectiveDate)!
    if (rank(o.pvState) > rank(e.state)) e.state = o.pvState
    if (o.objectSig !== '') e.sigs.add(o.objectSig)
  }
  return order.map((date) => {
    const e = byDate.get(date)!
    return { effectiveDate: date, pvState: e.state, objectSig: [...e.sigs].sort().join('|') }
  })
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
