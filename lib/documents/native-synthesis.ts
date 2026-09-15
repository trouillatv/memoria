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

// P0-2 — Suivi unifié historique + natif (mandat Vincent 2026-09-16) : population canonique
// unique (getNavigableSubjectsForSite), matrice PV et activité native = deux couches
// d'enrichissement, jamais une bascule "si historique alors historique seulement" (même
// référentiel que deriveCanonicalAttentionItems). Règle de fusion : un sujet sans aucune
// occurrence native passe VERBATIM (garantit un rendu historique-seul inchangé) ; un sujet
// sans aucun signal historique retombe sur la même dérivation que computeNativeWatchlist /
// computeNativeImportantSubjects ci-dessus (garantit un rendu natif-seul inchangé) ; seul un
// sujet réellement mixte déclenche une vraie fusion (staleness guard sur 'aggravé', objets
// actifs rafraîchis depuis l'état unifié).
export function computeUnifiedWatchlist(
  subjects: NavigableSubjectSummary[],
  pvWatchlist: WatchlistEntry[],
  matrixRunDates: string[],
  nativeOccurrences: Record<string, Array<{ date: string; sourceKind: 'field_visit' | 'meeting' }>>,
): WatchlistEntry[] {
  const priority: Record<WatchReason, number> = { non_conforme: 0, aggravé: 1, réouvert: 2, sans_évolution: 3 }
  const navByCsId = new Map(subjects.map((s) => [s.canonicalSubjectId, s]))
  const consumedCsIds = new Set(
    pvWatchlist.filter((w) => w.canonicalSubjectId).map((w) => w.canonicalSubjectId as string),
  )

  const nativeOnlyReason = (s: NavigableSubjectSummary): WatchReason | null => {
    if (s.durableKind === 'actor') return null
    if (s.displayState === 'reopened') return 'réouvert'
    if (s.isStagnant) return 'sans_évolution'
    return null
  }

  const fromPv = pvWatchlist
    .map((pv): WatchlistEntry | null => {
      const s = pv.canonicalSubjectId ? navByCsId.get(pv.canonicalSubjectId) : undefined
      // Sujet non résolu côté natif, ou sans aucune occurrence native : vérité historique inchangée.
      if (!s || s.nativeOccurrenceCount === 0) return pv

      const nativeReason = nativeOnlyReason(s)
      let reason: WatchReason | null = pv.reason
      if (pv.reason === 'aggravé') {
        // 'aggravé' est une transition de cellule PV pure : si une occurrence native plus
        // récente que le run source existe, le signal est potentiellement périmé.
        const runDate = matrixRunDates[pv.lastRunIndex]
        const occs = nativeOccurrences[s.canonicalSubjectId] ?? []
        const stale = runDate ? occs.some((o) => o.date > runDate) : false
        if (stale) reason = nativeReason
      }
      if (reason && nativeReason && priority[nativeReason] < priority[reason]) reason = nativeReason
      if (!reason) return null

      return { ...pv, reason, pvCount: pv.pvCount + s.nativeOccurrenceCount }
    })
    .filter((w): w is WatchlistEntry => w !== null)

  const additions: WatchlistEntry[] = []
  for (const s of subjects) {
    if (s.nativeOccurrenceCount === 0) continue
    if (consumedCsIds.has(s.canonicalSubjectId)) continue
    const reason = nativeOnlyReason(s)
    if (!reason) continue
    additions.push({
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

  const combined = [...fromPv, ...additions]
  combined.sort((a, b) => priority[a.reason] - priority[b.reason] || b.pvCount - a.pvCount)
  return combined
}

export function computeUnifiedImportantSubjects(
  subjects: NavigableSubjectSummary[],
  historicalImportant: ImportantSubject[],
): ImportantSubject[] {
  const navByCsId = new Map(subjects.map((s) => [s.canonicalSubjectId, s]))
  const consumedCsIds = new Set(historicalImportant.map((h) => h.canonicalSubjectId))

  const fromHistorical = historicalImportant.map((hist) => {
    const s = navByCsId.get(hist.canonicalSubjectId)
    if (!s || s.nativeOccurrenceCount === 0) return hist
    return {
      ...hist,
      pvCount: hist.pvCount + s.nativeOccurrenceCount,
      openActions: s.activeObjects.actionsOpen,
      openReserves: s.activeObjects.reservesOpen,
      activeDeadlines: s.activeObjects.deadlinesActive,
      reappearance: hist.reappearance || s.displayState === 'reopened',
      recentOccurrence: hist.recentOccurrence || s.presentInLastPv,
    }
  })

  const additions = subjects
    .filter((s) =>
      s.nativeOccurrenceCount > 0 &&
      !consumedCsIds.has(s.canonicalSubjectId) &&
      s.durableKind !== 'actor' &&
      (s.activeObjects.total > 0 || s.isStagnant || s.displayState === 'reopened'),
    )
    .map((s) => ({
      canonicalSubjectId: s.canonicalSubjectId,
      label: s.title,
      pvCount: s.nativeOccurrenceCount,
      openActions: s.activeObjects.actionsOpen,
      openReserves: s.activeObjects.reservesOpen,
      activeDeadlines: s.activeObjects.deadlinesActive,
      overdueDeadlines: 0,
      reappearance: s.displayState === 'reopened',
      recentOccurrence: s.presentInLastPv,
      score: s.activeObjects.total,
    }))

  return [...fromHistorical, ...additions].slice(0, IMPORTANT_MAX)
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
