// Helpers PURS (client-safe) de regroupement hebdomadaire pour Travaux —
// partagés par TravauxSubView (liste, server) et TravauxTimeline (frise,
// client). Ne dépendent jamais, directement ou transitivement, d'un module
// server-only : seul le type SitePlanningItem est importé (erasé à la
// compilation), jamais une valeur de lib/db/site-planning-items.ts.

import type { SitePlanningItem, PlanningItemSourceDocument } from '@/lib/db/site-planning-items'
import { getWeekRange } from '@/lib/week-planning-helpers'

export interface WeekGroup {
  key: string
  weekNumber: number
  weekStart: string
  weekEnd: string
  items: SitePlanningItem[]
}

export function groupByWeek(items: SitePlanningItem[]): WeekGroup[] {
  const groups = new Map<string, WeekGroup>()
  for (const item of items) {
    const range = getWeekRange(item.plannedStart as string)
    const key = `${range.year}-W${range.weekNumber}`
    if (!groups.has(key)) groups.set(key, { key, weekNumber: range.weekNumber, weekStart: range.weekStart, weekEnd: range.weekEnd, items: [] })
    groups.get(key)!.items.push(item)
  }
  return [...groups.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export interface WeekSourceExcerpt {
  key: string
  documentId: string
  filename: string
  excerpt: string | null
}

/** Une preuve textuelle par extrait distinct (pas par document) : deux tâches
 *  de la même semaine issues de lignes différentes du PDF montrent chacune
 *  leur propre extrait. Dédoublonne uniquement les extraits identiques —
 *  jamais de texte reconstruit quand `sourceExcerpt` est absent (fallback nom
 *  de fichier seul, doctrine V1-D.3 « preuve textuelle > lien source »). */
export function weekSourceExcerpts(items: SitePlanningItem[], sourceDocuments: Map<string, PlanningItemSourceDocument>): WeekSourceExcerpt[] {
  const seen = new Set<string>()
  const result: WeekSourceExcerpt[] = []
  for (const item of items) {
    const doc = item.sourceProposalId ? sourceDocuments.get(item.sourceProposalId) : undefined
    if (!doc) continue
    const dedupeKey = doc.sourceExcerpt ?? `doc:${doc.documentId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    result.push({ key: item.id, documentId: doc.documentId, filename: doc.filename, excerpt: doc.sourceExcerpt })
  }
  return result
}

/** Lundi (yyyy-mm-dd) de la semaine ISO contenant `iso` — clé de rapprochement avec `WeekGroup.weekStart`. */
export function weekOf(iso: string): string {
  return getWeekRange(iso).weekStart
}

const weekRangeDayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric' })
const weekRangeMonthFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long' })

/** « 17 → 23 AOÛT » (même mois) ou « 28 AOÛT → 3 SEPTEMBRE » (à cheval) — le
 *  mois n'est répété que quand il change, jamais sur les deux bornes. */
export function formatWeekRangeLabel(weekStart: string, weekEnd: string): string {
  const start = new Date(weekStart + 'T00:00:00Z')
  const end = new Date(weekEnd + 'T00:00:00Z')
  const startMonth = weekRangeMonthFmt.format(start).toUpperCase()
  const endMonth = weekRangeMonthFmt.format(end).toUpperCase()
  const startDay = weekRangeDayFmt.format(start)
  const endDay = weekRangeDayFmt.format(end)
  return startMonth === endMonth
    ? `${startDay} → ${endDay} ${endMonth}`
    : `${startDay} ${startMonth} → ${endDay} ${endMonth}`
}
