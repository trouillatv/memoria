// NORM-2 (mandat Vincent 2026-09-25) — rendu des sections de Prestations
// prévues, partagé desktop/mobile pour éviter deux implémentations métier
// divergentes. `gridClassName` reste au choix de l'appelant : mobile impose
// 1 colonne, desktop peut passer en 2 colonnes sur largeur suffisante.

import { plannedEngagementStatusLabel } from '@/lib/engagements/labels'
import { getSectionHomogeneousStatus, type PlannedEngagementSectionGroup } from '@/lib/engagements/section'
import { PlannedEngagementCard } from './PlannedEngagementCard'

export function PlannedEngagementSections({
  groups,
  gridClassName,
  canActivate = false,
}: {
  groups: PlannedEngagementSectionGroup[]
  gridClassName: string
  /** P0-3.2 — propage la permission d'activation (managerOrAdmin) à chaque carte. */
  canActivate?: boolean
}) {
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const homogeneousStatus = getSectionHomogeneousStatus(group)
        return (
          <section key={group.key} className="space-y-3">
            <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
              <h2 className="text-sm font-semibold text-foreground">{group.label}</h2>
              <span className="shrink-0 text-xs text-muted-foreground">
                {group.engagements.length}
                {homogeneousStatus ? ` · ${plannedEngagementStatusLabel(homogeneousStatus)}` : ''}
              </span>
            </div>
            <ul className={gridClassName}>
              {group.engagements.map((e) => (
                <PlannedEngagementCard key={e.id} engagement={e} showStatusBadge={!homogeneousStatus} canActivate={canActivate} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
