import 'server-only'

import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import type { WatchlistEntry, WatchReason } from './pv-watchlist'
import type { ImportantSubject } from './site-synthesis'

// P0-2 — Suivi natif-only (0 PV historique importé, ex. PETRO) : projette la MÊME vérité
// d'état (deriveCanonicalCurrentState → displayState, déjà unifiée historique+natif dans
// getNavigableSubjectsForSite) dans les mêmes types que la Synthèse PV (WatchlistEntry,
// ImportantSubject). Read-model unificateur, pas de nouvelle logique métier :
// - 'non_conforme' / 'aggravé' restent absents (granularité document_status, non portée par
//   NavigableSubjectSummary) ;
// - la catégorie thématique reste absente (non captée par l'extraction native aujourd'hui).
// Ce sont des replis assumés, pas des données fabriquées.

export function computeNativeWatchlist(subjects: NavigableSubjectSummary[]): WatchlistEntry[] {
  const result: WatchlistEntry[] = []
  for (const s of subjects) {
    if (s.durableKind === 'actor') continue
    let reason: WatchReason | null = null
    if (s.displayState === 'reopened') reason = 'réouvert'
    else if (s.isStagnant) reason = 'sans_évolution'
    if (!reason) continue
    result.push({
      subjectThreadId: s.canonicalSubjectId,
      canonicalSubjectId: s.canonicalSubjectId,
      label: s.title,
      thematicCategory: null,
      family: s.dominantFamily ?? 'unknown',
      reason,
      pvCount: s.nativeOccurrenceCount,
      totalRuns: 0,
      lastRunIndex: -1,
    })
  }
  const priority: Record<WatchReason, number> = { non_conforme: 0, aggravé: 1, réouvert: 2, sans_évolution: 3 }
  result.sort((a, b) => priority[a.reason] - priority[b.reason] || b.pvCount - a.pvCount)
  return result
}

const IMPORTANT_MAX = 6

export function computeNativeImportantSubjects(subjects: NavigableSubjectSummary[]): ImportantSubject[] {
  return subjects
    .filter((s) => s.durableKind !== 'actor' && (s.activeObjects.total > 0 || s.isStagnant || s.displayState === 'reopened'))
    .slice(0, IMPORTANT_MAX)
    .map((s) => ({
      canonicalSubjectId: s.canonicalSubjectId,
      label: s.title,
      pvCount: s.nativeOccurrenceCount,
      openActions: s.activeObjects.actionsOpen,
      openReserves: s.activeObjects.reservesOpen,
      activeDeadlines: s.activeObjects.deadlinesActive,
      // Non calculé côté natif : granularité échéance/retard absente de NavigableSubjectSummary.
      overdueDeadlines: 0,
      reappearance: s.displayState === 'reopened',
      recentOccurrence: s.presentInLastPv,
      score: s.activeObjects.total,
    }))
}

export interface NativeActivityEntry {
  date: string
  visits: number
  meetings: number
  subjectsCount: number
}

const ACTIVITY_MAX = 5

export function computeNativeRecentActivity(
  nativeOccurrences: Record<string, Array<{ date: string; sourceKind: 'field_visit' | 'meeting' }>>,
): NativeActivityEntry[] {
  const byDate = new Map<string, { visits: number; meetings: number; subjects: Set<string> }>()
  for (const [csId, occs] of Object.entries(nativeOccurrences)) {
    for (const o of occs) {
      const entry = byDate.get(o.date) ?? { visits: 0, meetings: 0, subjects: new Set<string>() }
      if (o.sourceKind === 'field_visit') entry.visits++
      else entry.meetings++
      entry.subjects.add(csId)
      byDate.set(o.date, entry)
    }
  }
  return [...byDate.entries()]
    .map(([date, v]) => ({ date, visits: v.visits, meetings: v.meetings, subjectsCount: v.subjects.size }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-ACTIVITY_MAX)
    .reverse()
}
