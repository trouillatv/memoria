// AVANT / APRÈS — comparaison NETTE de l'état métier d'un chantier entre DEUX BORNES LIBRES.
//
// Pourquoi une primitive séparée (et non `getPvDelta`) :
// `getPvDelta(from, to)` a la bonne signature mais renvoie la transition LOCALE du PV `to`
// (calculée relativement à `to−1`), jamais relativement à `from`. Sur des bornes adjacentes
// les deux coïncident ; sur une fenêtre large, non. Brancher un sélecteur de bornes libres
// dessus fabriquerait de la vérité opérationnelle fausse (réouvertures manquées, faux
// « Résolu » sur un sujet déjà résolu avant la borne, faux « Apparu » sur un sujet ancien).
// `getPvDelta` et `buildOccurrencePvSummary` restent INCHANGÉS et gelés : ils servent les
// 4 surfaces adjacentes existantes (Aperçu, Synthèse, Chronologie, site-activity).
//
// Ici on COMPOSE toute la fenêtre ]from, to] sur le MÊME substrat (`buildSiteSubjectCells`,
// P0-2) : aucun second moteur longitudinal, aucune IA, résultat déterministe.
//
// Règles métier non négociables :
//   - `unknown → connu` n'est PAS un changement métier, c'est un « état précisé » ;
//   - une absence documentaire n'est PAS un changement d'état : « plus mentionné » est une
//     catégorie DOCUMENTAIRE distincte, et l'état prouvé reporté n'est jamais altéré ;
//   - un sujet déjà `resolved` avant ET après la fenêtre est « inchangé », jamais « résolu » ;
//   - un sujet déjà connu avant la fenêtre n'est jamais « apparu ».
//
// PLAFOND TRI-STATE (mesuré, pas supposé) : `canonical_subject_occurrence.state_status` ne
// contient QUE {open, resolved, unknown, null} (1482/1482 lignes en base, 0 hors tri-state).
// `aggravé` / `progressé` / `annulé` sont donc STRUCTURELLEMENT inatteignables sur ce substrat
// (aucune des 680 cellules RUS ne les porte). Ils ne sont pas modélisés ici : les fabriquer
// depuis un tri-state serait inventer une gravité que la capture ne porte pas.

import type { OccTimelineCell, SiteSubjectCells } from './site-occurrence-timeline'

/** État d'un sujet À une borne. `absent` = aucune existence documentaire à cette date. */
export type WindowBoundState = 'absent' | 'unknown' | 'open' | 'resolved'

/**
 * Classification NETTE d'un sujet entre deux bornes. Exhaustive et mutuellement exclusive.
 *   changements métier  : apparu · réapparu · résolu · réouvert
 *   précision d'état    : état_précisé   (unknown → connu — PAS un changement métier)
 *   fait documentaire   : plus_mentionné (absence — PAS un changement d'état)
 *   stabilité           : inchangé
 */
export type WindowChangeCategory =
  | 'apparu'
  | 'réapparu'
  | 'résolu'
  | 'réouvert'
  | 'état_précisé'
  | 'plus_mentionné'
  | 'inchangé'

/** Catégories affichées d'emblée (vrais changements métier). Les autres sont repliées. */
export const NET_CHANGE_CATEGORIES: WindowChangeCategory[] = ['réouvert', 'résolu', 'apparu', 'réapparu']

export interface WindowSubjectDelta {
  canonicalSubjectId: string
  label: string
  family: string
  category: WindowChangeCategory
  beforeState: WindowBoundState
  afterState: WindowBoundState
  /** Le sujet était-il documenté AU PV de départ ? (présence, pas état) */
  presentAtFrom: boolean
  /** Le sujet est-il documenté AU PV d'arrivée ? */
  presentAtTo: boolean
  /** Nombre d'événements d'état observés DANS ]from, to] — sert à prouver « net ≠ union ». */
  stateEventCount: number
  /** Date documentaire du dernier événement d'état de la fenêtre (chronologie métier). */
  lastEventDate: string | null
}

/**
 * CŒUR PUR — compare UNE ligne de cellules entre deux index de runs.
 * Retourne `null` si le sujet n'a aucune existence documentaire à la borne d'arrivée
 * (rien à comparer : il n'existe pas encore dans l'histoire du chantier).
 *
 * Précédence (déterministe, un sujet = exactement une catégorie) :
 *   1. jamais vu avant/à `from`     → apparu          (invariant : un ancien n'est jamais « apparu »)
 *   2. open → resolved              → résolu
 *   3. resolved → open              → réouvert
 *   4. absent à la borne d'arrivée  → plus_mentionné  (fait documentaire, état porté intact)
 *   5. silencieux à `from`, présent à `to` → réapparu
 *   6. unknown → connu              → état_précisé
 *   7. sinon                        → inchangé
 * Un CHANGEMENT D'ÉTAT PROUVÉ prime sur la présence documentaire (2/3 avant 4) : une résolution
 * constatée en milieu de fenêtre reste une résolution même si le dernier PV n'en reparle pas.
 * Inversement une absence à l'arrivée n'est JAMAIS promue en « réapparu ».
 * L'état comparé est l'état PROUVÉ REPORTÉ à chaque borne (`currentProvenState`), donc la
 * non-mention n'invente jamais de résolution (invariant R-1 / P0-1).
 */
export function compareCellsAcrossWindow(
  cells: Array<OccTimelineCell | null>,
  fromIdx: number,
  toIdx: number,
): Omit<WindowSubjectDelta, 'canonicalSubjectId' | 'label' | 'family'> | null {
  const after = cells[toIdx] ?? null
  if (!after) return null
  const before = fromIdx >= 0 ? (cells[fromIdx] ?? null) : null

  const boundState = (c: OccTimelineCell | null): WindowBoundState =>
    c === null ? 'absent' : c.currentProvenState === null ? 'unknown' : c.currentProvenState

  const beforeState = boundState(before)
  const afterState = boundState(after)
  const presentAtFrom = before !== null && !before.isGap
  const presentAtTo = !after.isGap

  // Fenêtre ]from, to] : événements d'état réellement observés (matière, pas classification).
  let stateEventCount = 0
  let lastEventDate: string | null = null
  for (let i = Math.max(fromIdx + 1, 0); i <= toIdx; i++) {
    const c = cells[i]
    if (!c || c.isGap || c.observedTriState === null) continue
    stateEventCount++
    lastEventDate = c.effectiveDate
  }

  // Existence documentaire AVANT ou À la borne de départ (axe de présence, pas d'état).
  let seenBeforeWindow = false
  for (let i = 0; i <= fromIdx; i++) {
    const c = cells[i]
    if (c && !c.isGap) { seenBeforeWindow = true; break }
  }

  let category: WindowChangeCategory
  if (!seenBeforeWindow) {
    // La ligne de cellules ne démarre qu'à la 1re présence documentaire : si rien avant `from`,
    // le sujet est né DANS la fenêtre.
    category = 'apparu'
  } else if (beforeState === 'open' && afterState === 'resolved') {
    category = 'résolu'
  } else if (beforeState === 'resolved' && afterState === 'open') {
    category = 'réouvert'
  } else if (!presentAtTo) {
    // Connu avant, absent à la borne d'arrivée : fait DOCUMENTAIRE, l'état reste porté.
    category = 'plus_mentionné'
  } else if (!presentAtFrom) {
    category = 'réapparu'
  } else if (beforeState === 'unknown' && (afterState === 'open' || afterState === 'resolved')) {
    category = 'état_précisé'
  } else {
    category = 'inchangé'
  }

  return { category, beforeState, afterState, presentAtFrom, presentAtTo, stateEventCount, lastEventDate }
}

export interface SiteWindowComparison {
  siteId: string
  runs: Array<{ id: string; documentId: string; effectiveDate: string; pvNumber: number }>
  from: { runId: string; effectiveDate: string; pvNumber: number }
  to: { runId: string; effectiveDate: string; pvNumber: number }
  rows: WindowSubjectDelta[]
  counts: Record<WindowChangeCategory, number>
}

export type WindowComparisonRejection = 'no_runs' | 'unknown_bound' | 'same_bounds' | 'invalid_order'

export type WindowComparisonResult =
  | { ok: true; data: SiteWindowComparison }
  | { ok: false; reason: WindowComparisonRejection }

export function emptyWindowCounts(): Record<WindowChangeCategory, number> {
  return { apparu: 0, réapparu: 0, résolu: 0, réouvert: 0, état_précisé: 0, plus_mentionné: 0, inchangé: 0 }
}

/**
 * PRIMITIVE PURE de composition de fenêtre : projette une vue `SiteSubjectCells` (P0-2) en
 * une comparaison nette entre deux runs. Aucune dépendance UI, aucun accès base, aucune IA.
 * `excludeSubjectIds` = acteurs (#228), fourni par l'appelant : la primitive ne lit rien.
 */
export function deriveWindowComparison(
  view: SiteSubjectCells,
  fromRunId: string,
  toRunId: string,
  excludeSubjectIds: ReadonlySet<string> = new Set(),
): WindowComparisonResult {
  if (view.runs.length === 0) return { ok: false, reason: 'no_runs' }
  if (fromRunId === toRunId) return { ok: false, reason: 'same_bounds' }
  const fromIdx = view.runs.findIndex((r) => r.id === fromRunId)
  const toIdx = view.runs.findIndex((r) => r.id === toRunId)
  if (fromIdx < 0 || toIdx < 0) return { ok: false, reason: 'unknown_bound' }
  if (toIdx <= fromIdx) return { ok: false, reason: 'invalid_order' }

  const rows: WindowSubjectDelta[] = []
  const counts = emptyWindowCounts()
  for (const row of view.rows) {
    if (excludeSubjectIds.has(row.canonicalSubjectId)) continue
    const cmp = compareCellsAcrossWindow(row.cells, fromIdx, toIdx)
    if (!cmp) continue
    rows.push({
      canonicalSubjectId: row.canonicalSubjectId,
      label: row.label,
      family: row.family,
      ...cmp,
    })
    counts[cmp.category] += 1
  }
  rows.sort((a, b) => a.label.localeCompare(b.label, 'fr'))

  const runs = view.runs.map((r, i) => ({ ...r, pvNumber: i + 1 }))
  return {
    ok: true,
    data: {
      siteId: view.siteId,
      runs,
      from: { runId: view.runs[fromIdx].id, effectiveDate: view.runs[fromIdx].effectiveDate, pvNumber: fromIdx + 1 },
      to: { runId: view.runs[toIdx].id, effectiveDate: view.runs[toIdx].effectiveDate, pvNumber: toIdx + 1 },
      rows,
      counts,
    },
  }
}

/** Orchestrateur base : même substrat P0-2 que la Synthèse/Chronologie, acteurs exclus (#228). */
export async function buildSiteWindowComparison(
  siteId: string,
  fromRunId: string,
  toRunId: string,
): Promise<WindowComparisonResult> {
  const [{ buildSiteSubjectCells }, { getActorCanonicalIds }] = await Promise.all([
    import('./site-occurrence-timeline'),
    import('./occurrence-population'),
  ])
  const [view, actors] = await Promise.all([
    buildSiteSubjectCells(siteId),
    getActorCanonicalIds(siteId).catch(() => new Set<string>()),
  ])
  return deriveWindowComparison(view, fromRunId, toRunId, actors)
}
