import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Info, ListTodo } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { readSiteActionSummaries, groupActionsByThread, readReportStartDates } from '@/lib/knowledge/repository'
import { todayLocalIso } from '@/lib/time/local-date'
import { SiteTabsNav } from '../SiteTabsNav'
import { ActionsListClient, type ActionGroupDisplay } from './ActionsListClient'

export const dynamic = 'force-dynamic'

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function urgencyOf(dueDate: string | null, today: string, weekEnd: string): ActionGroupDisplay['urgency'] {
  if (!dueDate) return 'undated'
  if (dueDate < today) return 'late'
  if (dueDate === today) return 'today'
  if (dueDate <= weekEnd) return 'week'
  return 'later'
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

  // Groupes dédupliqués (représentant + compteur + PV sources)
  const rawOpen = actionRows.filter((a) => a.status === 'open' || a.status === 'planned')
  const groups = groupActionsByThread(rawOpen)
    .sort((a, b) => (a.representative.due_date ?? '9999').localeCompare(b.representative.due_date ?? '9999'))

  // Dates des PV sources
  const allReportIds = [...new Set(groups.flatMap((g) => g.reportIds))]
  const reportDates = await readReportStartDates(allReportIds)

  // KPI counts
  const lateCount    = groups.filter((g) => g.representative.due_date && g.representative.due_date < today).length
  const todayCount   = groups.filter((g) => g.representative.due_date === today).length
  const weekCount    = groups.filter((g) => {
    const d = g.representative.due_date
    return d && d > today && d <= weekEnd
  }).length
  const undatedCount = groups.filter((g) => !g.representative.due_date).length

  // Provenance : décompter les origines distinctes
  const pvReportIds = new Set(groups.flatMap((g) => g.reportIds))
  const pvCount = pvReportIds.size
  // Plage dates PV
  const pvDates = [...pvReportIds]
    .map((rid) => reportDates.get(rid) ?? null)
    .filter((d): d is string => Boolean(d))
    .sort()
  const pvDateRange = pvDates.length >= 2
    ? `${new Date(pvDates[0]).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })} → ${new Date(pvDates[pvDates.length - 1]).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}`
    : pvDates.length === 1
    ? new Date(pvDates[0]).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : null

  // Groupes normalisés pour le composant client (uniquement JSON-serializable)
  const displayGroups: ActionGroupDisplay[] = groups.map((g) => {
    const rep = g.representative
    // Date PV = date du premier report_id disponible
    const pvDate = g.reportIds.length > 0 ? (reportDates.get(g.reportIds[0]) ?? null) : null
    return {
      id: rep.id,
      title: rep.title,
      href: `/sites/${id}/actions`,
      count: g.count,
      pvDate,
      pvCount: g.reportIds.length,
      due_date: rep.due_date,
      assigned_to: rep.assigned_to ?? null,
      urgency: urgencyOf(rep.due_date, today, weekEnd),
      actionHref: `/sites/${id}/action/${rep.id}`,
    }
  })

  const hasUrgency = lateCount > 0 || todayCount > 0 || weekCount > 0

  return (
    <div className="max-w-3xl space-y-6 py-6">
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

      <header className="space-y-3">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
          <ListTodo className="h-5 w-5" /> Sujets d&apos;action
        </h1>

        {/* 4 KPI chips */}
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${lateCount > 0 ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-muted text-muted-foreground'}`}>
            <span className="text-lg font-bold leading-none">{lateCount}</span> en retard
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${todayCount > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>
            <span className="text-lg font-bold leading-none">{todayCount}</span> aujourd&apos;hui
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${weekCount > 0 ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'bg-muted text-muted-foreground'}`}>
            <span className="text-lg font-bold leading-none">{weekCount}</span> cette semaine
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
            <span className="text-lg font-bold leading-none">{undatedCount}</span> à planifier
          </span>
        </div>

        {/* Message rassurant si aucune urgence */}
        {!hasUrgency && groups.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Aucune urgence aujourd&apos;hui · {groups.length} sujet{groups.length > 1 ? 's' : ''} à organiser.
          </p>
        )}
      </header>

      {/* Provenance */}
      {pvCount > 0 && (
        <div className="rounded-xl border bg-muted/30 px-4 py-3">
          <p className="text-sm font-medium">Origine des sujets</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {groups.length} sujet{groups.length > 1 ? 's' : ''} issu{groups.length > 1 ? 's' : ''} de PV historiques
            {' · '}{pvCount} document{pvCount > 1 ? 's' : ''}
            {pvDateRange && ` · ${pvDateRange}`}
          </p>
        </div>
      )}

      {/* Aide discrète */}
      <div className="flex items-start gap-2 rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          MemorIA regroupe les demandes répétées portant sur le même sujet.
          Une ligne représente un sujet à organiser ou traiter, même s&apos;il a été mentionné plusieurs fois dans des documents différents.
        </span>
      </div>

      {/* Liste interactive */}
      {groups.length > 0 ? (
        <ActionsListClient groups={displayGroups} siteId={id} />
      ) : (
        <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Aucun sujet d&apos;action ouvert sur ce chantier.
        </p>
      )}
    </div>
  )
}
