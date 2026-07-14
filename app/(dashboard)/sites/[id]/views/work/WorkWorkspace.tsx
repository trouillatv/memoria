import Link from 'next/link'
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { todayLocalIso } from '@/lib/time/local-date'
import type { SiteActionRow } from '@/lib/db/site-actions'
import type { SiteBlocage } from '@/lib/db/site-blocages'
import type { SupervisorInterventionRow } from '@/lib/db/interventions'
import type { DbMission } from '@/types/db'

interface WorkWorkspaceProps {
  siteId: string
  actions: SiteActionRow[]
  blocages: SiteBlocage[]
  missions: DbMission[]
  interventions: SupervisorInterventionRow[]
}

export function WorkWorkspace({ siteId, actions, blocages, missions, interventions }: WorkWorkspaceProps) {
  const todayIso = todayLocalIso()
  const plannedInterventions = interventions.filter((intervention) => intervention.status !== 'completed' && intervention.status !== 'validated')
  const overdueActions = actions.filter((action) => action.due_date && action.due_date < todayIso)
  const todayActions = actions.filter((action) => action.due_date === todayIso)
  const undatedActions = actions.filter((action) => !action.due_date)
  const sortedActions = [...actions].sort((a, b) => {
    const aDue = a.due_date ?? '9999-12-31'
    const bDue = b.due_date ?? '9999-12-31'
    return aDue.localeCompare(bDue) || a.created_at.localeCompare(b.created_at)
  })

  return (
    <main className="space-y-5">
      <section className="rounded-[22px] border bg-card px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Travail</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ici, je peux savoir ce qui reste à produire et pourquoi.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <StatusPill active label="À traiter" value={actions.length + blocages.length + plannedInterventions.length} />
            <StatusPill label="En retard" value={overdueActions.length} tone={overdueActions.length > 0 ? 'red' : 'neutral'} />
            <StatusPill label="Aujourd'hui" value={todayActions.length} />
            <StatusPill label="Sans échéance" value={undatedActions.length} />
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <SectionTitle icon={ClipboardList} title={`Missions (${missions.length})`} detail="Le niveau supérieur du travail prévu sur ce chantier." />
        {missions.length > 0 ? (
          <div className="mt-4 divide-y rounded-2xl border">
            {missions.map((mission) => {
              const missionInterventions = plannedInterventions.filter((intervention) => intervention.mission_id === mission.id)
              const missionActions = sortedActions.filter((action) => action.corps_etat && action.corps_etat.toLowerCase() === mission.name.toLowerCase()).slice(0, 3)
              const missionBlocages = blocages.filter((blocage) => {
                const haystack = `${blocage.title} ${blocage.description ?? ''} ${blocage.impact ?? ''}`.toLowerCase()
                return haystack.includes(mission.name.toLowerCase())
              }).slice(0, 3)
              const completed = missionInterventions.filter((intervention) => intervention.status === 'completed' || intervention.status === 'validated').length
              const total = missionInterventions.length

              return (
                <article key={mission.id} className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mission</p>
                      <h2 className="mt-1 text-lg font-semibold">{mission.name}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {mission.active ? 'En cours' : 'Inactive'}
                        {mission.assigned_team_id ? ` · équipe affectée` : ' · équipe non affectée'}
                      </p>
                    </div>
                    <Link href={`/missions/${mission.id}`} className="inline-flex w-fit items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                      Ouvrir la mission
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <Metric label="Interventions" value={missionInterventions.length} />
                    <Metric label="Actions liées" value={missionActions.length} />
                    <Metric label="Réserves/blocages" value={missionBlocages.length} />
                  </div>
                  {total > 0 && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Progression factuelle : {completed}/{total} interventions terminées ou validées.
                    </p>
                  )}
                  {(missionActions.length > 0 || missionInterventions.length > 0 || missionBlocages.length > 0) && (
                    <div className="mt-4 grid gap-4 lg:grid-cols-3">
                      <MiniList title="Actions" items={missionActions.map((action) => action.title)} empty="Aucune action liée par corps d'état." />
                      <MiniList title="Interventions" items={missionInterventions.slice(0, 3).map((intervention) => interventionLabel(intervention))} empty="Aucune intervention planifiée." />
                      <MiniList title="Réserves" items={missionBlocages.map((blocage) => blocage.title)} empty="Aucun blocage identifié." />
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        ) : (
          <EmptyMessage>Aucune mission créée sur ce chantier.</EmptyMessage>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={CalendarClock} title={`Interventions (${plannedInterventions.length})`} detail="Ce qui est prévu ou reste à exécuter." />
            <div className="mt-4 divide-y rounded-2xl border">
              {plannedInterventions.length > 0 ? plannedInterventions.slice(0, 8).map((intervention) => (
                <Link key={intervention.id} href={`/interventions/${intervention.id}`} className="block p-4 hover:bg-muted/40">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold">{interventionLabel(intervention)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Issue de : {intervention.mission?.name ? `Mission ${intervention.mission.name}` : 'Mission non renseignée'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Destination : produire une preuve de réalisation.
                      </p>
                    </div>
                    <div className="text-sm text-muted-foreground md:text-right">
                      <p>{formatDateTime(intervention.scheduled_at)}</p>
                      <p>{intervention.team?.name ?? 'Équipe non affectée'}</p>
                    </div>
                  </div>
                </Link>
              )) : (
                <EmptyMessage>Aucune intervention ouverte ou planifiée.</EmptyMessage>
              )}
            </div>
          </section>

          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={CheckCircle2} title={`Actions (${sortedActions.length})`} detail="Chaque action affiche sa provenance quand elle est connue." />
            <div className="mt-4 divide-y rounded-2xl border">
              {sortedActions.length > 0 ? sortedActions.slice(0, 10).map((action) => (
                <Link key={action.id} href={`/sites/${siteId}/actions`} className="block p-4 hover:bg-muted/40">
                  <div className="grid gap-3 lg:grid-cols-[1fr_180px]">
                    <div>
                      <p className="font-semibold">{action.title}</p>
                      <dl className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                        <Fact label="Issue de" value={action.report_id ? 'Visite ou réunion liée' : 'Origine non renseignée'} />
                        <Fact label="Mission" value={action.corps_etat ?? action.contract_name ?? 'Mission non renseignée'} />
                        <Fact label="Responsable" value={action.assigned_to ?? 'Non affecté'} />
                        <Fact label="Destination" value={action.converted_to_type ? `${action.converted_to_type} créée` : 'Intervention à planifier'} />
                      </dl>
                    </div>
                    <div className="text-sm text-muted-foreground lg:text-right">
                      <p className={cn(action.due_date && action.due_date < todayIso ? 'font-medium text-red-600' : '')}>
                        {action.due_date ? `Échéance : ${formatDate(action.due_date)}` : 'Sans échéance'}
                      </p>
                      {action.snooze_reason && <p className="mt-1">Report : {action.snooze_reason}</p>}
                    </div>
                  </div>
                </Link>
              )) : (
                <EmptyMessage>Aucune action ouverte.</EmptyMessage>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={ShieldAlert} title={`Réserves et blocages (${blocages.length})`} detail="Ce qui empêche ou ralentit le chantier." />
            <div className="mt-4 space-y-3">
              {blocages.length > 0 ? blocages.map((blocage) => (
                <Link key={blocage.id} href={`/sites/${siteId}/reserves`} className="block rounded-2xl border p-4 hover:bg-muted/40">
                  <p className="font-semibold">{blocage.title}</p>
                  <p className="mt-1 text-sm text-red-600">Ouvert depuis {formatDate(blocage.dateStart)}</p>
                  <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <Fact label="Issue de" value={blocage.sourceReportId ? 'Visite ou réunion liée' : 'Origine non renseignée'} />
                    <Fact label="Bloque" value={blocage.impact ?? 'Impact non renseigné'} />
                  </dl>
                </Link>
              )) : (
                <EmptyMessage>Aucun blocage ouvert.</EmptyMessage>
              )}
            </div>
          </section>

          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={AlertTriangle} title="Échéances" detail="Ce qui approche ou reste à dater." />
            <div className="mt-4 space-y-3">
              <DeadlineGroup title="En retard" actions={overdueActions} siteId={siteId} />
              <DeadlineGroup title="Aujourd'hui" actions={todayActions} siteId={siteId} />
              <DeadlineGroup title="Sans échéance" actions={undatedActions.slice(0, 4)} siteId={siteId} />
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}

function StatusPill({ label, value, active = false, tone = 'neutral' }: { label: string; value: number; active?: boolean; tone?: 'neutral' | 'red' }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-2 rounded-full border px-3 py-1.5',
      active ? 'bg-foreground text-background' : 'bg-background text-muted-foreground',
      tone === 'red' && value > 0 ? 'border-red-200 bg-red-50 text-red-700' : '',
    )}>
      {label}
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  )
}

function SectionTitle({ icon: Icon, title, detail }: { icon: typeof ClipboardList; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function MiniList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm">
          {items.map((item) => <li key={item}>- {item}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  )
}

function DeadlineGroup({ title, actions, siteId }: { title: string; actions: SiteActionRow[]; siteId: string }) {
  return (
    <div className="rounded-2xl border p-3">
      <p className="text-sm font-semibold">{title}</p>
      {actions.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {actions.map((action) => (
            <li key={action.id}>
              <Link href={`/sites/${siteId}/actions`} className="text-sm hover:underline">{action.title}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Aucun élément.</p>
      )}
    </div>
  )
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">{children}</p>
}

function interventionLabel(intervention: SupervisorInterventionRow): string {
  return intervention.mission?.name ?? 'Intervention'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
}
