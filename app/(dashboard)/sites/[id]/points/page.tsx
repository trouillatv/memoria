import { redirect, notFound } from 'next/navigation'
import { ListChecks, MapPin } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteMemoryBuildStatus } from '@/lib/db/site-reports'
import { loadSiteTrackedPointList } from '@/lib/knowledge/tracked-point-list'
import { loadMemoriaNeedsYouSummary, computeChantierNeedsYouCount } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { PointsPageTabs } from '@/components/knowledge/PointsPageTabs'
import { SiteMemoryBuildIndicator } from '@/components/knowledge/SiteMemoryBuildIndicator'
import { SiteChantierNav } from '../SiteChantierNav'

interface PageProps {
  params: Promise<{ id: string }>
  // ptype/pdeadline : filtres Pilotage (mandat Vincent 2026-09-15, URL-ready dès ce lot).
  searchParams: Promise<{ tab?: string; ptype?: string; pdeadline?: string }>
}

export default async function SitePointsPage({ params, searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const { tab, ptype, pdeadline } = await searchParams
  const [identity, list, needsYouSummary, memoryBuildStatus] = await Promise.all([
    getSiteIdentity(id),
    loadSiteTrackedPointList(id, user.id),
    loadMemoriaNeedsYouSummary(id),
    // Sous-lot 4 (mandat Vincent 2026-09-17) : même signal chantier que Suivi, même primitive.
    getSiteMemoryBuildStatus(id).catch(() => ({ isProcessing: false, hasError: false, siteReportId: null })),
  ])
  if (!identity) notFound()

  // Doctrine « Question sur un Point connu → sur le Point. Question avant création/rattachement
  // d'un Point → au niveau chantier. » (mandat Vincent 2026-09-17) : confirm_trackability et
  // clarify_evidence n'ont jamais de pointId, donc jamais de badge Point — surfacées ici comme
  // compteur chantier distinct, transmis à PointsPageTabs → PointsPilotageView.
  const chantierNeedsYouCount = computeChantierNeedsYouCount(needsYouSummary.categories)

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId={id} label={identity.name} />
      <DynamicCrumb segmentId="points" label="Points" />
      {identity.clientName && (
        <BreadcrumbPrefix crumbs={[
          { href: '/sites', label: 'Chantiers' },
          { href: '/sites', label: identity.clientName },
        ]} />
      )}

      <SiteChantierNav siteId={id} siteName={identity.name} clientName={identity.clientName} activeTab="points" />

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-muted-foreground" />
          Points
        </h1>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1 mt-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {identity.name}
          {identity.clientName ? ` · ${identity.clientName}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          Toutes les situations suivies sur ce chantier, avec leur état réel et leur dernière évolution.
        </p>
        <SiteMemoryBuildIndicator status={memoryBuildStatus} className="mt-1" />
      </header>

      <PointsPageTabs
        points={list.points}
        filterOptions={list.filters}
        pointHrefPrefix={`/sites/${id}/point`}
        subjectHrefPrefix={`/sites/${id}/historique/sujets`}
        siteId={id}
        lastPvDate={list.lastPvDate}
        chantierNeedsYouCount={chantierNeedsYouCount}
        defaultTab={tab === 'delta' ? 'delta' : undefined}
        defaultPilotageTypeFilter={ptype}
        defaultPilotageDeadlineFilter={pdeadline}
      />
    </div>
  )
}
