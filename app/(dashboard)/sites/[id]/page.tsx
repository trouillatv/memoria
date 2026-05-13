// Page Mémoire du lieu (Phase 3.3).
//
// Vue projetée d'un site : « À savoir » actifs en haut, puis timeline
// chronologique des événements (interventions, photos, anomalies, notes,
// À savoir historiques). Aucune saisie au niveau du site lui-même — la
// page consolide ce qui existe ailleurs.

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  CalendarCheck,
  Camera,
  AlertTriangle,
  StickyNote,
  Sparkles,
  MapPin,
  Building2,
  Clock,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteById, listSiteASavoirActive } from '@/lib/db/sites'
import { getSiteMemoryTimeline, type SiteMemoryEvent, type SiteMemoryEventType } from '@/lib/db/site-memory'
import { ASavoirManager } from './ASavoirManager'

interface PageProps {
  params: Promise<{ id: string }>
}

const TYPE_ICON: Record<SiteMemoryEventType, React.ComponentType<{ className?: string }>> = {
  intervention: CalendarCheck,
  photo: Camera,
  anomaly: AlertTriangle,
  note: StickyNote,
  a_savoir: Sparkles,
}

const TYPE_LABEL: Record<SiteMemoryEventType, string> = {
  intervention: 'Intervention',
  photo: 'Photo',
  anomaly: 'Anomalie',
  note: 'Note',
  a_savoir: 'À savoir',
}

const TYPE_TINT: Record<SiteMemoryEventType, string> = {
  intervention: 'text-sky-600 bg-sky-50',
  photo: 'text-emerald-600 bg-emerald-50',
  anomaly: 'text-amber-600 bg-amber-50',
  note: 'text-muted-foreground bg-muted/30',
  a_savoir: 'text-violet-600 bg-violet-50',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const diff = today.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days < 1) return "aujourd'hui"
  if (days < 2) return 'hier'
  if (days < 7) return `il y a ${days} j`
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default async function SitePage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const site = await getSiteById(id)
  if (!site) notFound()

  const [aSavoirActive, timeline] = await Promise.all([
    listSiteASavoirActive(id),
    getSiteMemoryTimeline(id, { limit: 100 }),
  ])

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="space-y-1">
        <Link
          href="/sites"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          ← Sites
        </Link>
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Building2 className="h-6 w-6 text-brand-600" />
          {site.name}
        </h1>
        {site.address && (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> {site.address}
          </p>
        )}
      </header>

      <ASavoirManager siteId={id} active={aSavoirActive} />

      <section>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
          Mémoire du lieu ({timeline.length})
        </h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center border rounded-lg">
            Pas encore d&apos;événement enregistré sur ce lieu.
          </p>
        ) : (
          <ol className="space-y-2">
            {timeline.map((e) => (
              <Event key={`${e.type}-${e.id}`} event={e} />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function Event({ event }: { event: SiteMemoryEvent }) {
  const Icon = TYPE_ICON[event.type]
  const tint = TYPE_TINT[event.type]
  const href = event.interventionId ? `/interventions/${event.interventionId}` : null
  const inner = (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-3 hover:bg-muted/20 transition-colors">
      <div className={`shrink-0 rounded-full p-1.5 ${tint}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground">{TYPE_LABEL[event.type]}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" /> {formatDate(event.occurredAt)}
          </span>
        </div>
        <div className="text-sm mt-0.5 truncate" title={event.title}>
          {event.title}
        </div>
        {event.detail && (
          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{event.detail}</div>
        )}
        {event.status && (
          <span className="inline-block mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {event.status}
          </span>
        )}
      </div>
    </div>
  )

  return href ? (
    <li>
      <Link href={href}>{inner}</Link>
    </li>
  ) : (
    <li>{inner}</li>
  )
}
