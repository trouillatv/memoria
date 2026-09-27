// ENG-UX-1 LOT F (mandat Vincent 2026-09-26), formulation étendue PLAN-UX-1D
// (mandat Vincent 2026-09-27) — synthèse légère de la page Prestations
// prévues, dérivée UNIQUEMENT de computePlannedEngagementSynthesis (LOT B/C),
// aucune nouvelle vérité persistée. Partagé desktop/mobile comme
// PlannedEngagementSections (NORM-2). Ordre et libellés calqués sur l'exemple
// de Vincent : total, à mettre en vigueur, en vigueur, organisés, à
// planifier, actions ouvertes.

import type { PlannedEngagementSynthesis } from '@/lib/engagements/section'

export function PlannedEngagementSynthesisHeader({ synthesis }: { synthesis: PlannedEngagementSynthesis }) {
  const items: Array<{ label: string; value: number }> = [
    { label: 'engagement' + (synthesis.total > 1 ? 's' : ''), value: synthesis.total },
    { label: 'à mettre en vigueur', value: synthesis.curatedCount },
    { label: 'en vigueur', value: synthesis.activeCount },
    { label: 'organisé' + (synthesis.withMission > 1 ? 's' : ''), value: synthesis.withMission },
    { label: 'à planifier', value: synthesis.needsPlanning },
    { label: 'action' + (synthesis.openActionsCount > 1 ? 's' : '') + ' ouverte' + (synthesis.openActionsCount > 1 ? 's' : ''), value: synthesis.openActionsCount },
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
