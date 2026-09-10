import { redirect, notFound } from 'next/navigation'
import { ListChecks, MapPin } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { loadSiteTrackedPointList } from '@/lib/knowledge/tracked-point-list'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { PointsListView } from '@/components/knowledge/PointsListView'
import { SiteChantierNav } from '../SiteChantierNav'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SitePointsPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, list] = await Promise.all([
    getSiteIdentity(id),
    loadSiteTrackedPointList(id),
  ])
  if (!identity) notFound()

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

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-muted-foreground" />
          Points
        </h1>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {identity.name}
          {identity.clientName ? ` · ${identity.clientName}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          Toutes les situations suivies sur ce chantier, avec leur état réel et leur dernière évolution.
        </p>
      </header>

      <PointsListView
        points={list.points}
        filterOptions={list.filters}
        pointHrefPrefix={`/sites/${id}/point`}
        subjectHrefPrefix={`/sites/${id}/historique/sujets`}
      />
    </div>
  )
}
