// P3-3c — logique PURE de navigation de la page Actions (recherche + filtres).
// Aucune vérité métier : lit uniquement les états AUTORITATIFS déjà exposés par le
// read-model (PilotageCbo.active / .terminal / .computedCurrentState). Aucune DB, aucun
// React, aucun serveur → testable seul et réutilisable côté client.

import type { PilotageSubject, PilotageCbo } from '@/lib/knowledge/actions-pilotage'

// P3-3c — pas de filtre « À qualifier » ici : les CBO à-qualifier du KPI sont majoritairement
// DANGLING (sans canonical_subject_id) → hors de la population sujet-first. Filtrer dessus
// afficherait « 0 » sous un KPI « 38 » = contradiction UX. La curation des dangling est un autre job.
export type ActionsFilter = 'all' | 'open' | 'reopened' | 'treated'

/** Recherche déterministe : minuscule, sans accents, trim. Substring, aucun fuzzy. */
export function normalizeSearch(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

/**
 * Prédicat par CBO, strictement adossé aux classes C2A déjà calculées (jamais recalculées) :
 *   open      → open | progressing
 *   reopened  → native_reopened | documentary_reopened
 *   treated   → terminal (documentary_completed | native_completed | native_cancelled | conforme_at)
 */
export function cboMatchesFilter(c: PilotageCbo, f: ActionsFilter): boolean {
  switch (f) {
    case 'all': return true
    case 'open': return c.computedCurrentState === 'open' || c.computedCurrentState === 'progressing'
    case 'reopened': return c.computedCurrentState === 'native_reopened' || c.computedCurrentState === 'documentary_reopened'
    case 'treated': return c.terminal
  }
}

/** Un sujet correspond au filtre s'il possède ≥1 CBO correspondant (page sujet-first). */
export function subjectMatchesFilter(s: PilotageSubject, f: ActionsFilter): boolean {
  if (f === 'all') return true
  return s.cbos.some((c) => cboMatchesFilter(c, f))
}

/** Un sujet correspond à la recherche si son titre OU ≥1 label de CBO contient la requête. */
export function subjectMatchesSearch(s: PilotageSubject, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true
  if (normalizeSearch(s.label).includes(normalizedQuery)) return true
  return s.cbos.some((c) => normalizeSearch(c.label).includes(normalizedQuery))
}

/** Recherche ET filtre, tous deux au niveau SUJET. */
export function filterPilotageSubjects(subjects: PilotageSubject[], query: string, filter: ActionsFilter): PilotageSubject[] {
  const nq = normalizeSearch(query)
  return subjects.filter((s) => subjectMatchesFilter(s, filter) && subjectMatchesSearch(s, nq))
}

/** Compte de SUJETS par filtre, à recherche courante appliquée (pour les chips cliquables). */
export function countByFilter(subjects: PilotageSubject[], query: string): Record<ActionsFilter, number> {
  const nq = normalizeSearch(query)
  const searched = subjects.filter((s) => subjectMatchesSearch(s, nq))
  const n = (f: ActionsFilter) => searched.filter((s) => subjectMatchesFilter(s, f)).length
  return { all: searched.length, open: n('open'), reopened: n('reopened'), treated: n('treated') }
}
