import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Clock, ListTodo } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { readSiteActionSummaries, deduplicateByThread } from '@/lib/knowledge/repository'
import { todayLocalIso } from '@/lib/time/local-date'
import { SiteTabsNav } from '../SiteTabsNav'

export const dynamic = 'force-dynamic'

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

export default async function SiteActionsHub({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, actionRows] = await Promise.all([
    getSiteIdentity(id),
    readSiteActionSummaries(id),
  ])
  if (!identity) notFound()

  const today = todayLocalIso()
  const weekEnd = addDays(today, 7)

  const openActions = deduplicateByThread(
    actionRows
      .filter((a) => a.status === 'open' || a.status === 'planned')
      .sort((a, b) => (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1),
  )

  const late    = openActions.filter((a) => a.due_date && a.due_date < today)
  const today_  = openActions.filter((a) => a.due_date && a.due_date === today)
  const week    = openActions.filter((a) => a.due_date && a.due_date > today && a.due_date <= weekEnd)
  const undated = openActions.filter((a) => !a.due_date)

  return (
    <div className="space-y-5">
      {/* Navigation chantier */}
      <div className="space-y-3">
        <Link
          href={`/sites/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {identity.name}
        </Link>
        <SiteTabsNav active="apercu" siteId={id} />
      </div>

      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
          <ListTodo className="h-5 w-5" /> Sujets d&apos;action
        </h1>
        <p className="text-sm text-muted-foreground">
          {openActions.length} sujet{openActions.length !== 1 ? 's' : ''} d&apos;action ouverts
          {late.length > 0 && (
            <span className="font-medium text-rose-600"> · {late.length} en retard</span>
          )}
        </p>
      </header>

      {/* En retard */}
      {late.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-rose-600">
            <Clock className="h-4 w-4" /> En retard
          </h2>
          <ul className="space-y-1.5">
            {late.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/50 px-4 py-3 dark:border-rose-900/40 dark:bg-rose-950/20">
                <span className="min-w-0 flex-1">
                  <Link href={`/sites/${id}/action/${a.id}`} scroll={false} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                </span>
                {a.due_date && (
                  <span className="shrink-0 text-xs text-rose-600">depuis le {formatDue(a.due_date)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Aujourd'hui */}
      {today_.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-amber-600">Aujourd&apos;hui</h2>
          <ul className="space-y-1.5">
            {today_.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                <span className="min-w-0 flex-1">
                  <Link href={`/sites/${id}/action/${a.id}`} scroll={false} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Cette semaine */}
      {week.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Cette semaine</h2>
          <ul className="space-y-1.5">
            {week.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-xl border px-4 py-3">
                <span className="min-w-0 flex-1">
                  <Link href={`/sites/${id}/action/${a.id}`} scroll={false} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                </span>
                {a.due_date && (
                  <span className="shrink-0 text-xs text-muted-foreground">le {formatDue(a.due_date)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sans date / À planifier */}
      {undated.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Sans date · À planifier ({undated.length})
          </h2>
          <ul className="space-y-1.5">
            {undated.map((a) => (
              <li key={a.id} className="rounded-xl border border-dashed px-4 py-3 text-sm">
                <Link href={`/sites/${id}/action/${a.id}`} scroll={false} className="font-medium hover:underline">
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {openActions.length === 0 && (
        <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Aucun sujet d&apos;action ouvert sur ce chantier.
        </p>
      )}
    </div>
  )
}
