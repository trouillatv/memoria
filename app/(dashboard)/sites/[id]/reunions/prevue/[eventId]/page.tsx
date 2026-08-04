import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Calendar } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { listScheduledEvents, scheduledTypeLabel } from '@/lib/db/scheduled-events'
import { SiteBriefButton } from '../../../SiteBriefButton'
import { startScheduledEventAction } from '../../../scheduled-event-actions'

export const dynamic = 'force-dynamic'

export default async function ReunionPrevuePage({
  params,
}: {
  params: Promise<{ id: string; eventId: string }>
}) {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, eventId } = await params

  try {
    await requireSiteAccess(id)
  } catch {
    redirect('/sites')
  }

  const [identity, events] = await Promise.all([
    getSiteIdentity(id).catch(() => null),
    listScheduledEvents(id).catch(() => []),
  ])

  if (!identity) notFound()

  const event = events.find((e) => e.id === eventId)
  if (!event || event.type !== 'meeting') notFound()

  const payload = event.payload as { type: 'meeting'; agenda?: string; participantIds?: string[] }
  const dateLabel = new Date(event.plannedStart).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: event.plannedStart.length > 10 ? '2-digit' : undefined,
    minute: event.plannedStart.length > 10 ? '2-digit' : undefined,
    timeZone: 'Pacific/Noumea',
  })

  const statusLabel = event.status === 'postponed' ? 'Reportée' : 'Planifiée'
  const statusClass = event.status === 'postponed'
    ? 'bg-amber-100 text-amber-800'
    : 'bg-sky-100 text-sky-800'

  const startAction = startScheduledEventAction.bind(null, eventId, id)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-1 py-6">
      <Link
        href={`/sites/${id}?tab=planning`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>

      <div className="rounded-[22px] border bg-card p-6 shadow-sm space-y-5">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
            <Calendar className="h-5 w-5" />
          </span>
          <div>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass} mb-1`}>
              {scheduledTypeLabel(event.type)} · {statusLabel}
            </span>
            <h1 className="text-xl font-semibold">{event.title ?? 'Réunion de chantier'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{dateLabel}</p>
          </div>
        </div>

        {payload.agenda && (
          <section className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Ordre du jour</p>
            <p className="text-sm whitespace-pre-wrap">{payload.agenda}</p>
          </section>
        )}

        {!payload.agenda && (
          <p className="text-sm italic text-muted-foreground">Aucun ordre du jour défini.</p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
          <SiteBriefButton siteId={id} mode="meeting" variant="desktop" label="Préparer la réunion" />
          <form action={startAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
            >
              Démarrer la réunion
            </button>
          </form>
          <Link
            href={`/sites/${id}?tab=planning`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Voir le planning
          </Link>
        </div>
      </div>
    </div>
  )
}
