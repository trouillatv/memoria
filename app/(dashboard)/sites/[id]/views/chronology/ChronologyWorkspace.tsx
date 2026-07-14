import Link from 'next/link'
import { ChevronDown, FileText, History, MessageSquare, Wrench } from 'lucide-react'
import type { SiteActionRow } from '@/lib/db/site-actions'
import type { SiteBlocage } from '@/lib/db/site-blocages'
import type { SupervisorInterventionRow } from '@/lib/db/interventions'
import type { VisitWithCounts } from '@/lib/db/visits'
import type { OverviewChangeInput } from '@/lib/chantier/overview-projections'

interface ChronologyWorkspaceProps {
  siteId: string
  visits: VisitWithCounts[]
  changes: OverviewChangeInput[]
  actions: SiteActionRow[]
  blocages: SiteBlocage[]
  interventions: SupervisorInterventionRow[]
}

export function ChronologyWorkspace({
  siteId,
  visits,
  changes,
  actions,
  blocages,
  interventions,
}: ChronologyWorkspaceProps) {
  const interventionEvents = interventions.slice(0, 6)
  const hasEvents = visits.length > 0 || interventionEvents.length > 0 || changes.length > 0

  return (
    <main className="space-y-5">
      <section className="rounded-[22px] border bg-card px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Chronologie</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ici, je peux comprendre comment on en est arrivé là.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-foreground px-3 py-1.5 text-background">Flux</span>
            <span className="rounded-full border px-3 py-1.5 text-muted-foreground">Toutes activités</span>
            <span className="rounded-full border px-3 py-1.5 text-muted-foreground">Cette semaine</span>
            <Link href={`/sites/${siteId}/recit`} className="rounded-full border px-3 py-1.5 font-medium hover:bg-muted">
              Lire le récit
            </Link>
          </div>
        </div>
      </section>

      {hasEvents ? (
        <ol className="relative space-y-5 border-l border-border pl-5">
          {visits.map(({ visit, photos, notes, reserves, actions: actionCount }) => {
            const visitActions = actions.filter((action) => action.report_id === visit.id)
            const visitBlocages = blocages.filter((blocage) => blocage.sourceReportId === visit.id)
            const producedCount = photos + notes + reserves + actionCount

            return (
              <li key={visit.id} className="relative">
                <TimelineDot tone="blue" />
                <article className="rounded-[22px] border bg-card p-5 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{formatDateTime(visit.started_at ?? visit.created_at)} · Visite</p>
                      <h2 className="mt-1 text-lg font-semibold">{visit.objective?.trim() || 'Visite terrain'}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {photos} photo{photos > 1 ? 's' : ''} · {notes} note{notes > 1 ? 's' : ''} · {actionCount} action{actionCount > 1 ? 's' : ''} · {reserves} réserve{reserves > 1 ? 's' : ''}
                      </p>
                    </div>
                    <Link href={`/sites/${siteId}/visites/${visit.id}`} className="inline-flex w-fit items-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                      Ouvrir la visite
                    </Link>
                  </div>

                  <details className="mt-4 rounded-2xl border bg-muted/20 p-4" open={producedCount > 0}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
                      <span>Ce que cette visite a produit</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {actionCount} actions · {reserves} réserves · {photos} documents
                        <ChevronDown className="h-4 w-4" />
                      </span>
                    </summary>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <ProducedList
                        title="Actions créées"
                        empty={actionCount > 0 ? `${actionCount} action(s) dans la fenêtre de visite.` : 'Aucune action liée à cette visite.'}
                        items={visitActions.map((action) => ({ id: action.id, label: action.title, href: `/sites/${siteId}/actions` }))}
                      />
                      <ProducedList
                        title="Réserves et blocages"
                        empty={reserves > 0 ? `${reserves} réserve(s) dans la fenêtre de visite.` : 'Aucune réserve liée à cette visite.'}
                        items={visitBlocages.map((blocage) => ({ id: blocage.id, label: blocage.title, href: `/sites/${siteId}/reserves` }))}
                      />
                      <ProducedList
                        title="Documents"
                        empty={photos > 0 ? `${photos} photo(s) ou fichier(s) capturé(s).` : 'Aucun document capturé.'}
                        items={[]}
                      />
                      <ProducedList
                        title="Mémoire"
                        empty={notes > 0 ? `${notes} note(s) ajoutée(s) à la mémoire du chantier.` : 'Aucun élément mémoire identifié.'}
                        items={[]}
                      />
                    </div>
                  </details>
                </article>
              </li>
            )
          })}

          {interventionEvents.map((intervention) => (
            <li key={intervention.id} className="relative">
              <TimelineDot tone={intervention.status === 'completed' || intervention.status === 'validated' ? 'green' : 'orange'} />
              <article className="rounded-[22px] border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{formatDateTime(intervention.scheduled_at)} · Intervention</p>
                    <h2 className="mt-1 text-lg font-semibold">{intervention.mission?.name ?? 'Intervention'}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {intervention.status === 'completed' || intervention.status === 'validated' ? 'Terminée' : 'Planifiée'} · {intervention.team?.name ?? 'équipe non affectée'}
                    </p>
                  </div>
                  <Link href={`/interventions/${intervention.id}`} className="inline-flex w-fit items-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                    Ouvrir
                  </Link>
                </div>
                <details className="mt-4 rounded-2xl border bg-muted/20 p-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
                    <span>Ce que cette intervention a produit</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      Résultat opérationnel
                      <ChevronDown className="h-4 w-4" />
                    </span>
                  </summary>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <ProducedList title="Preuves" empty="Les preuves restent sur la fiche intervention." items={[]} />
                    <ProducedList title="Statut" empty={intervention.status === 'validated' ? 'Intervention validée.' : `Statut : ${intervention.status}.`} items={[]} />
                  </div>
                </details>
              </article>
            </li>
          ))}

          {changes.slice(0, 6).map((change) => (
            <li key={change.id} className="relative">
              <TimelineDot tone="neutral" />
              <article className="rounded-[18px] border bg-card p-4 shadow-sm">
                {change.href ? (
                  <Link href={change.href} className="block hover:underline">
                    <ChangeContent change={change} />
                  </Link>
                ) : (
                  <ChangeContent change={change} />
                )}
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
          <History className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Aucun événement récent correspondant aux filtres.</p>
          <p className="mt-1 text-sm text-muted-foreground">Les visites, réunions, interventions, décisions, preuves et réserves apparaîtront ici.</p>
        </section>
      )}
    </main>
  )
}

function ProducedList({
  title,
  items,
  empty,
}: {
  title: string
  items: Array<{ id: string; label: string; href: string }>
  empty: string
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="inline-flex items-center gap-2 text-sm font-medium hover:underline">
                <FileText className="h-4 w-4 text-muted-foreground" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}

function ChangeContent({ change }: { change: OverviewChangeInput }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
        {change.kind === 'intervention_done' ? <Wrench className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
      </span>
      <div>
        <p className="font-semibold">{change.title}</p>
        {change.detail && <p className="mt-1 text-sm text-muted-foreground">{change.detail}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(change.occurredAt)}</p>
      </div>
    </div>
  )
}

function TimelineDot({ tone }: { tone: 'blue' | 'green' | 'orange' | 'neutral' }) {
  const className = {
    blue: 'bg-sky-500',
    green: 'bg-emerald-500',
    orange: 'bg-orange-500',
    neutral: 'bg-muted-foreground',
  }[tone]
  return <span className={`absolute -left-[25px] top-6 h-3 w-3 rounded-full ${className} ring-4 ring-background`} />
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
}
