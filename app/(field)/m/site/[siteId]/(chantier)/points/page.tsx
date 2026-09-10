import { notFound } from 'next/navigation'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadSiteTrackedPointList } from '@/lib/knowledge/tracked-point-list'
import { PointsListView } from '@/components/knowledge/PointsListView'

export const dynamic = 'force-dynamic'

export default async function MobilePointsPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const list = await loadSiteTrackedPointList(siteId)

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header>
        <h1 className="text-xl font-semibold">Points</h1>
        <p className="text-[13px] text-muted-foreground">
          {list.points.length} Point{list.points.length !== 1 ? 's' : ''} suivi{list.points.length !== 1 ? 's' : ''}
        </p>
      </header>

      <PointsListView
        points={list.points}
        filterOptions={list.filters}
        pointHrefPrefix={`/m/site/${siteId}/point`}
        subjectHrefPrefix={`/m/site/${siteId}/sujets`}
      />
    </div>
  )
}
