// ENG-UX-1 LOT F (mandat Vincent 2026-09-26) — synthèse légère de la page
// Prestations prévues, dérivée UNIQUEMENT de computePlannedEngagementSynthesis
// (LOT B/C), aucune nouvelle vérité persistée. Partagé desktop/mobile comme
// PlannedEngagementSections (NORM-2).

import type { PlannedEngagementSynthesis } from '@/lib/engagements/section'

export function PlannedEngagementSynthesisHeader({ synthesis }: { synthesis: PlannedEngagementSynthesis }) {
  const items: Array<{ label: string; value: number }> = [
    { label: 'engagement' + (synthesis.total > 1 ? 's' : ''), value: synthesis.total },
    { label: 'avec mission', value: synthesis.withMission },
    { label: 'à planifier', value: synthesis.needsPlanning },
    { label: 'action' + (synthesis.openActionsCount > 1 ? 's' : '') + ' ouverte' + (synthesis.openActionsCount > 1 ? 's' : ''), value: synthesis.openActionsCount },
    { label: 'sans mission', value: synthesis.withoutMission },
  ]

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label}>
          <span className="font-semibold text-foreground">{item.value}</span> {item.label}
        </span>
      ))}
    </div>
  )
}
