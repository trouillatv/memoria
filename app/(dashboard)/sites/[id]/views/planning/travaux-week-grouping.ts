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

export function weekSources(items: SitePlanningItem[], sourceDocuments: Map<string, PlanningItemSourceDocument>): PlanningItemSourceDocument[] {
  const seen = new Map<string, PlanningItemSourceDocument>()
  for (const item of items) {
    const doc = item.sourceProposalId ? sourceDocuments.get(item.sourceProposalId) : undefined
    if (doc) seen.set(doc.documentId, doc)
  }
  return [...seen.values()]
}

/** Lundi (yyyy-mm-dd) de la semaine ISO contenant `iso` — clé de rapprochement avec `WeekGroup.weekStart`. */
export function weekOf(iso: string): string {
  return getWeekRange(iso).weekStart
}
