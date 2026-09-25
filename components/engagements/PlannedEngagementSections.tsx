// NORM-2 (mandat Vincent 2026-09-25) — rendu des sections de Prestations
// prévues, partagé desktop/mobile pour éviter deux implémentations métier
// divergentes. `gridClassName` reste au choix de l'appelant : mobile impose
// 1 colonne, desktop peut passer en 2 colonnes sur largeur suffisante.

import { plannedEngagementStatusLabel } from '@/lib/engagements/labels'
import { getSectionHomogeneousStatus, type PlannedEngagementSectionGroup } from '@/lib/engagements/section'
import type { EngagementMission } from '@/lib/db/engagements'
import type { EngagementAction } from '@/lib/db/site-action-engagement-links'
import { PlannedEngagementCard } from './PlannedEngagementCard'

export function PlannedEngagementSections({
  groups,
  gridClassName,
  siteId,
  canActivate = false,
  canPlan = false,
  canTreatPoint = false,
  missionsByEngagement,
  actionsByEngagement,
}: {
  groups: PlannedEngagementSectionGroup[]
  gridClassName: string
  /** P0-3.5B — requis par PlannedEngagementCard pour construire le lien
   *  « Créer une mission » (route site-first). */
  siteId: string
  /** P0-3.2 — propage la permission d'activation (managerOrAdmin) à chaque carte. */
  canActivate?: boolean
  /** « Créer une mission » / « Planifier la prochaine intervention » (P0-3.5B,
   *  renommé ENG-UX-1 LOT E) — propage la permission (managerOrAdmin) à chaque carte. */
  canPlan?: boolean
  /** « Traiter un point » — propage la permission (managerOrAdmin) à chaque carte. */
  canTreatPoint?: boolean
  /** ENG-UX-1 LOT B/D — Missions par engagement, batchées côté page. */
  missionsByEngagement?: Map<string, EngagementMission[]>
  /** ENG-UX-1 LOT C/D — Actions liées par engagement, batchées côté page. */
  actionsByEngagement?: Map<string, EngagementAction[]>
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
                <PlannedEngagementCard
                  key={e.id}
                  engagement={e}
                  showStatusBadge={!homogeneousStatus}
                  siteId={siteId}
                  canActivate={canActivate}
                  canPlan={canPlan}
                  canTreatPoint={canTreatPoint}
                  missions={missionsByEngagement?.get(e.id) ?? []}
                  actions={actionsByEngagement?.get(e.id) ?? []}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
