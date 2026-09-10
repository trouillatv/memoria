// ── LOT 2 « Aujourd'hui » — synthèse d'en-tête (mandat Vincent) ──
//
// Une phrase courte, jamais un nouveau moteur : tally pur sur les `PointReadModelEntry`
// déjà chargés (mêmes champs que les 3 blocs) + le total déjà calculé par
// `loadMemoriaNeedsYouSummary`. Aucune donnée n'est recalculée, seulement comptée.

import type { PointReadModelEntry } from '@/lib/knowledge/tracked-point-read-model'

const RECENT_RESOLUTION_WINDOW_DAYS = 14

export interface SiteTodaySynthesis {
  totalPoints: number
  openPoints: number
  reopenedPoints: number
  resolvedRecently: number
  needsYouCount: number
  lastActivityAt: string | null
}

function daysSince(iso: string, today: string): number {
  return Math.round((new Date(today).getTime() - new Date(iso).getTime()) / 86_400_000)
}

export function computeSiteTodaySynthesis(
  points: readonly PointReadModelEntry[],
  needsYouCount: number,
  today: string,
): SiteTodaySynthesis {
  let openPoints = 0
  let reopenedPoints = 0
  let resolvedRecently = 0
  let lastActivityAt: string | null = null

  for (const p of points) {
    if (p.derivedState === 'open' || p.derivedState === 'conflict') openPoints += 1
    if (p.derivedState === 'reopened') reopenedPoints += 1
    if (
      p.derivedState === 'resolved' &&
      p.latestMeaningfulEventAt &&
      daysSince(p.latestMeaningfulEventAt, today) <= RECENT_RESOLUTION_WINDOW_DAYS
    ) {
      resolvedRecently += 1
    }
    if (p.latestMeaningfulEventAt && (!lastActivityAt || p.latestMeaningfulEventAt > lastActivityAt)) {
      lastActivityAt = p.latestMeaningfulEventAt
    }
  }

  return { totalPoints: points.length, openPoints, reopenedPoints, resolvedRecently, needsYouCount, lastActivityAt }
}
