import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { BookOpen, MapPin, Download, QrCode } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteJournal } from '@/lib/db/site-journal'
import { getSiteDayLogs, mergeWeatherIntoJournal } from '@/lib/db/site-day-log'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { JournalView } from './JournalView'
import { DayWeatherForm } from './DayWeatherForm'
import { SiteWeatherFetch } from './SiteWeatherFetch'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SiteJournalPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, rawEntries, dayLogs] = await Promise.all([
    getSiteIdentity(id),
    getSiteJournal(id),
    getSiteDayLogs(id),
  ])

  if (!identity) notFound()

  // Attache la météo aux jours + injecte les jours d'intempérie sans intervention.
  const entries = mergeWeatherIntoJournal(rawEntries, dayLogs)

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId="journal" label="Journal terrain" />
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
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            Journal terrain
          </h1>
          <a
            href={`/sites/${id}/journal/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title="Télécharger le journal complet en PDF"
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </a>
          <Link
            href={`/sites/${id}/qr`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title="Afficher ou générer le QR Code chantier"
          >
            <QrCode className="h-3.5 w-3.5" />
            QR
          </Link>
        </div>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {identity.name}
          {identity.clientName ? ` · ${identity.clientName}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          Historique complet des interventions — qui était là, ce qui s&apos;est passé, quelles entreprises étaient présentes.
        </p>
      </header>

      <SiteWeatherFetch siteId={id} />

      <DayWeatherForm siteId={id} />

      <JournalView entries={entries} />
    </div>
  )
}
