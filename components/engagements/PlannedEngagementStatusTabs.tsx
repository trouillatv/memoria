// PLAN-UX-1D (mandat Vincent 2026-09-27) — navigation par état de pilotage de
// la page Prestations prévues. Même philosophie que SiteTabsNav : liens
// serveur (URL-partageable), aucun état client. Les autres filtres actifs
// (Nature/Catégorie/Provenance/Document/Recherche) sont préservés au
// changement d'onglet — seul `tab` change.

import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  PLANNED_ENGAGEMENT_TAB_LABELS,
  PLANNED_ENGAGEMENT_TAB_ORDER,
  type PlannedEngagementTabKey,
} from '@/lib/engagements/section'

function tabHref(
  tab: PlannedEngagementTabKey,
  siteId: string,
  otherParams: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(otherParams)) {
    if (value) params.set(key, value)
  }
  if (tab !== 'all') params.set('tab', tab)
  const qs = params.toString()
  return `/sites/${siteId}/prestations${qs ? `?${qs}` : ''}`
}

export function PlannedEngagementStatusTabs({
  active,
  counts,
  siteId,
  otherParams,
}: {
  active: PlannedEngagementTabKey
  counts: Record<PlannedEngagementTabKey, number>
  siteId: string
  otherParams: Record<string, string | undefined>
}) {
  return (
    <nav
      aria-label="États des Prestations prévues"
      className="flex items-center gap-5 overflow-x-auto border-b border-border/80"
    >
      {PLANNED_ENGAGEMENT_TAB_ORDER.map((tab) => (
        <Link
          key={tab}
          aria-current={active === tab ? 'page' : undefined}
          href={tabHref(tab, siteId, otherParams)}
          className={cn(
            'shrink-0 border-b-2 px-0 py-2.5 text-sm font-medium transition-colors',
            active === tab
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
          )}
        >
          {PLANNED_ENGAGEMENT_TAB_LABELS[tab]}
          <span className="ml-1.5 text-xs text-muted-foreground">{counts[tab]}</span>
        </Link>
      ))}
    </nav>
  )
}
