import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { BookOpen, MapPin } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteJournal } from '@/lib/db/site-journal'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { JournalView } from './JournalView'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SiteJournalPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, entries] = await Promise.all([
    getSiteIdentity(id),
    getSiteJournal(id),
  ])

  if (!identity) notFound()

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId="journal" label="Journal" />
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
          <BookOpen className="h-5 w-5 text-muted-foreground" />
          Journal du chantier
        </h1>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {identity.name}
          {identity.clientName ? ` · ${identity.clientName}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          Historique complet des interventions — qui était là, ce qui s&apos;est passé, quelles entreprises étaient présentes.
        </p>
      </header>

      <JournalView entries={entries} />
    </div>
  )
}
