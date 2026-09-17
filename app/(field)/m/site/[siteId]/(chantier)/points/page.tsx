import { notFound } from 'next/navigation'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadSiteTrackedPointList } from '@/lib/knowledge/tracked-point-list'
import { loadMemoriaNeedsYouSummary, computeChantierNeedsYouCount } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { PointsPageTabs } from '@/components/knowledge/PointsPageTabs'

export const dynamic = 'force-dynamic'

export default async function MobilePointsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  // ptype/pdeadline : filtres Pilotage (mandat Vincent 2026-09-15, URL-ready dès ce lot).
  searchParams: Promise<{ tab?: string; ptype?: string; pdeadline?: string }>
}) {
  const { siteId } = await params
  const { tab, ptype, pdeadline } = await searchParams
  const { user } = await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const [list, needsYouSummary] = await Promise.all([
    loadSiteTrackedPointList(siteId, user.id),
    loadMemoriaNeedsYouSummary(siteId),
  ])
  // Doctrine « question sur un Point connu → sur le Point ; question avant Point → chantier »
  // (mandat Vincent 2026-09-17), même calcul que la page desktop.
  const chantierNeedsYouCount = computeChantierNeedsYouCount(needsYouSummary.categories)

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header>
        <h1 className="text-xl font-semibold">Points</h1>
        <p className="text-[13px] text-muted-foreground">
          {list.points.length} Point{list.points.length !== 1 ? 's' : ''} suivi{list.points.length !== 1 ? 's' : ''}
        </p>
      </header>

      <PointsPageTabs
        points={list.points}
        filterOptions={list.filters}
        pointHrefPrefix={`/m/site/${siteId}/point`}
        subjectHrefPrefix={`/m/site/${siteId}/sujets`}
        siteId={siteId}
        lastPvDate={list.lastPvDate}
        chantierNeedsYouCount={chantierNeedsYouCount}
        defaultTab={tab === 'delta' ? 'delta' : undefined}
        defaultPilotageTypeFilter={ptype}
        defaultPilotageDeadlineFilter={pdeadline}
      />
    </div>
  )
}
