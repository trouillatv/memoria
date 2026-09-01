// ── Classement déterministe « À traiter » (14A) ─────────────────────────────
// Moteur PUR (aucun I/O, aucun `server-only`) : remplace l'ordre SQL implicite du
// bloc « À traiter » par une hiérarchie explicite et prouvable, calculée
// UNIQUEMENT depuis les données déjà portées par l'item — échéance
// (retard/imminence), signal `pv_reopened` du sujet (réouverture), date
// d'ouverture (ancienneté). La raison affichée provient du MÊME calcul que le
// rang : jamais un score opaque, jamais un LLM, jamais une colonne DB nouvelle.
//
// La provenance PV n'est PAS un critère : la récence n'est pas fiablement
// prouvable ici (`report.created_at` = date d'ingestion ; la date métier vit dans
// `documents.effective_date`, hors de ce read-model, et vaut plusieurs mois sur le
// corpus réel). Elle reste au mieux une information secondaire, jamais un rang.
//
// Séparé de live-debrief.ts (server-only) pour rester importable partout — mais
// c'est le moteur DESKTOP : seul `getSiteBriefAction` (variant='desktop') l'appelle.

import type { LiveDebriefItem } from './live-debrief'

export type ToHandlePriority = 'retard' | 'imminence' | 'reopened' | 'age'

export interface ToHandleRank {
  priority: ToHandlePriority
  /** Raison principale, affichable telle quelle (déterministe, factuelle). */
  reason: string
  /** Complément court et optionnel (ex. date d'échéance absolue). */
  secondary: string | null
}

// Aligné sur le seuil `deadline_near` de canonical-attention (7 jours) : une même
// notion d'« imminence » dans les deux moteurs, jamais un seuil réinventé.
const IMMINENCE_HORIZON_DAYS = 7

const PRIORITY_ORDER: Record<ToHandlePriority, number> = {
  retard: 0,
  imminence: 1,
  reopened: 2,
  age: 3,
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// `openedAt` vient de `created_at`/`issued_on` : ce peut être un timestamptz
// complet (`2026-08-27T01:17:25+00:00`), pas seulement une date `YYYY-MM-DD`. On
// tronque toujours à la date avant de calculer, sinon `new Date('…T…+00:00T00:00:00Z')`
// est Invalid Date → NaN (bug détecté par la recette moteur BELLA).
function daysBetweenIso(fromIso: string, toIso: string): number {
  const f = fromIso.slice(0, 10)
  const t = toIso.slice(0, 10)
  return Math.round(
    (new Date(`${t}T00:00:00Z`).getTime() - new Date(`${f}T00:00:00Z`).getTime()) / 86_400_000,
  )
}

function frDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** Échéance opposable au classement retard/imminence : seules Action et Échéance
 *  en portent une (`date` = due_date en disposition to_handle). La `date` d'une
 *  Réserve est sa date d'émission (`issued_on`), jamais une échéance. */
function deadlineDateOf(item: LiveDebriefItem): string | null {
  if (item.kind === 'action' || item.kind === 'deadline') return item.date
  return null
}

function openedAtOf(item: LiveDebriefItem): string | null {
  if (item.kind === 'informational_signal') return null
  return item.openedAt ?? null
}

function stableIdOf(item: LiveDebriefItem): string {
  return item.kind === 'informational_signal' ? item.signalKey : item.id
}

/** Comparaison croissante avec nulls en dernier (déterministe). */
function cmpNullableAsc(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

function computeToHandleRank(
  item: LiveDebriefItem,
  ctx: { reopened: Set<string>; today: string; horizon: string },
): ToHandleRank {
  const dd = deadlineDateOf(item)
  const opened = openedAtOf(item)
  const isReopened = !!item.canonicalSubjectId && ctx.reopened.has(item.canonicalSubjectId)

  // 1. RETARD — échéance datée déjà dépassée. Le fait déclencheur EST la date.
  if (dd && dd < ctx.today) {
    const n = daysBetweenIso(dd, ctx.today)
    const reason = item.kind === 'deadline' ? `Échéance dépassée de ${n} j` : `En retard de ${n} j`
    return { priority: 'retard', reason, secondary: `Échéance le ${frDate(dd)}` }
  }

  // 2. IMMINENCE — échéance datée dans l'horizon proche.
  if (dd && dd >= ctx.today && dd <= ctx.horizon) {
    const n = daysBetweenIso(ctx.today, dd)
    const reason = n === 0 ? 'Échéance aujourd’hui' : `Échéance dans ${n} j`
    return { priority: 'imminence', reason, secondary: `le ${frDate(dd)}` }
  }

  // 3. RÉOUVERTURE PROUVÉE — signal `pv_reopened` porté par le sujet canonique.
  if (isReopened) {
    return {
      priority: 'reopened',
      reason: 'Sujet rouvert',
      secondary: opened ? `Ouvert depuis ${daysBetweenIso(opened, ctx.today)} j` : null,
    }
  }

  // 4. ANCIENNETÉ / OUVERTURE SIMPLE — dernier niveau, dégradation gracieuse.
  if (item.kind === 'informational_signal') {
    return { priority: 'age', reason: item.reasons[0] ?? item.title, secondary: null }
  }
  if (dd) {
    // Échéance datée mais lointaine (au-delà de l'horizon) : ni en retard ni imminente.
    return { priority: 'age', reason: `Échéance le ${frDate(dd)}`, secondary: null }
  }
  if (opened) {
    const n = daysBetweenIso(opened, ctx.today)
    if (item.kind === 'reserve') return { priority: 'age', reason: `Réserve ouverte depuis ${n} j`, secondary: null }
    return { priority: 'age', reason: `Ouverte depuis ${n} j`, secondary: null }
  }
  // Aucune donnée temporelle : jamais de raison inventée.
  const fallback = item.kind === 'reserve' ? 'Réserve ouverte' : item.kind === 'deadline' ? 'Échéance à planifier' : 'Action ouverte'
  return { priority: 'age', reason: fallback, secondary: null }
}

/**
 * Classement déterministe du bloc « À traiter » (14A), pur et sans I/O. Remplace
 * l'ordre SQL implicite par la hiérarchie retard > imminence > réouverture >
 * ancienneté, avec tie-breaks stables à chaque niveau (échéance asc, puis date
 * d'ouverture asc, puis id). Chaque item ressort annoté d'un `rank` dont la
 * `reason` provient du MÊME calcul que le rang. Ne mute pas les items d'entrée.
 *
 * Desktop uniquement : appelé par `getSiteBriefAction` quand variant==='desktop'.
 * `buildLiveDebrief` ne l'appelle jamais — le mobile garde l'ordre object-first.
 */
export function rankLiveDebriefToHandle(
  items: LiveDebriefItem[],
  opts: { reopenedSubjectIds: Iterable<string>; today: string },
): LiveDebriefItem[] {
  const reopened = opts.reopenedSubjectIds instanceof Set ? opts.reopenedSubjectIds : new Set(opts.reopenedSubjectIds)
  const ctx = { reopened, today: opts.today, horizon: addDaysIso(opts.today, IMMINENCE_HORIZON_DAYS) }

  const ranked = items.map((item) => ({ item, rank: computeToHandleRank(item, ctx) }))
  ranked.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.rank.priority]
    const pb = PRIORITY_ORDER[b.rank.priority]
    if (pa !== pb) return pa - pb
    if (a.rank.priority === 'retard' || a.rank.priority === 'imminence') {
      const c = cmpNullableAsc(deadlineDateOf(a.item), deadlineDateOf(b.item))
      if (c) return c
    }
    const co = cmpNullableAsc(openedAtOf(a.item), openedAtOf(b.item))
    if (co) return co
    const cd = cmpNullableAsc(deadlineDateOf(a.item), deadlineDateOf(b.item))
    if (cd) return cd
    const ia = stableIdOf(a.item)
    const ib = stableIdOf(b.item)
    return ia < ib ? -1 : ia > ib ? 1 : 0
  })
  return ranked.map(({ item, rank }) => ({ ...item, rank }))
}
