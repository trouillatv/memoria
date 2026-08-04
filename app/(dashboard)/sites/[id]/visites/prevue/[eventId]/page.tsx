import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Calendar, ClipboardList } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { listScheduledEvents, scheduledTypeLabel } from '@/lib/db/scheduled-events'
import { listActivePreparationItems } from '@/lib/db/visit-preparation'
import { SiteBriefButton } from '../../../SiteBriefButton'
import { startScheduledEventAction } from '../../../scheduled-event-actions'

export const dynamic = 'force-dynamic'

export default async function VisitePrevuePage({
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

  const [identity, events, prepItems] = await Promise.all([
    getSiteIdentity(id).catch(() => null),
    listScheduledEvents(id).catch(() => []),
    listActivePreparationItems(id, user.id).catch(() => []),
  ])

  if (!identity) notFound()

  const event = events.find((e) => e.id === eventId)
  if (!event || event.type !== 'visit') notFound()

  const payload = event.payload as { type: 'visit'; objective?: string }
  const dateLabel = new Date(event.plannedStart).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: event.plannedStart.length > 10 ? '2-digit' : undefined,
    minute: event.plannedStart.length > 10 ? '2-digit' : undefined,
    timeZone: 'Pacific/Noumea',
  })

  const statusLabel = event.status === 'postponed' ? 'Reportée' : 'Planifiée'
  const statusClass = event.status === 'postponed'
    ? 'bg-amber-100 text-amber-800'
    : 'bg-emerald-100 text-emerald-800'

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
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <Calendar className="h-5 w-5" />
            </span>
            <div>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass} mb-1`}>
                {scheduledTypeLabel(event.type)} · {statusLabel}
              </span>
              <h1 className="text-xl font-semibold">{event.title ?? 'Visite planifiée'}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{dateLabel}</p>
            </div>
          </div>
        </div>

        {payload.objective && (
          <section className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Objectif</p>
            <p className="text-sm">{payload.objective}</p>
          </section>
        )}

        {prepItems.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" />
              Plan de visite · {prepItems.length} point{prepItems.length > 1 ? 's' : ''}
            </p>
            <ul className="space-y-2">
              {prepItems.map((item) => (
                <li key={item.id} className="rounded-xl border bg-background px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{item.label}</span>
                    {item.priority !== 'normal' && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        item.priority === 'critical'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {item.priority === 'critical' ? 'Critique' : 'Important'}
                      </span>
                    )}
                  </div>
                  {item.reason && (
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{item.reason}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {prepItems.length === 0 && (
          <p className="text-sm italic text-muted-foreground">
            Aucun point de visite préparé.{' '}
            <Link href={`/sites/${id}`} className="underline underline-offset-2">
              Ajouter via le Copilote
            </Link>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
          <SiteBriefButton siteId={id} mode="visit" variant="desktop" label="Préparer ma visite" />
          <form action={startAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Démarrer la visite
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
