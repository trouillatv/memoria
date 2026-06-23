import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { BookText, MapPin } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteNarrative } from '@/lib/db/site-narrative'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SiteNarrativeView } from './SiteNarrativeView'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SiteRecitPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, narrative] = await Promise.all([getSiteIdentity(id), getSiteNarrative(id)])
  if (!identity) notFound()

  return (
    <div className="space-y-6 w-full max-w-2xl">
      <DynamicCrumb segmentId="recit" label="Récit" />
      <BreadcrumbPrefix crumbs={[
        { href: '/sites', label: 'Sites' },
        { href: `/sites/${id}`, label: identity.name },
      ]} />

      <Link
        href={`/sites/${id}`}
        className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
      >
        ← {identity.name}
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <BookText className="h-5 w-5 text-muted-foreground" />
          Récit du chantier
        </h1>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {identity.name}
          {identity.clientName ? ` · ${identity.clientName}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          L&apos;histoire du chantier — les jalons (réunions, blocages, livraisons, réserves, décisions), lus
          comme un récit, pas comme un tableau.
        </p>
      </header>

      <SiteNarrativeView narrative={narrative} />
    </div>
  )
}
