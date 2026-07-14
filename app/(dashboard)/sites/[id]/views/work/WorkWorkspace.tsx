import Link from 'next/link'
import type { ReactNode } from 'react'
import { CalendarClock, CheckCircle2, ChevronDown, ClipboardList, ShieldAlert, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { interventionStatusLabel } from '@/lib/chantier/labels'
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
  const plannedInterventions = interventions.filter((intervention) => !isDone(intervention))
  const overdueActions = actions.filter((action) => action.due_date && action.due_date < todayIso)
  const todayActions = actions.filter((action) => action.due_date === todayIso)
  const weekActions = actions.filter((action) => action.due_date && action.due_date > todayIso && action.due_date <= addDays(todayIso, 7))
  const undatedActions = actions.filter((action) => !action.due_date)
  const unteamedMissions = missions.filter((mission) => !mission.assigned_team_id)
  const sortedActions = [...actions].sort((a, b) => {
    const aDue = a.due_date ?? '9999-12-31'
    const bDue = b.due_date ?? '9999-12-31'
    return aDue.localeCompare(bDue) || a.created_at.localeCompare(b.created_at)
  })

  const priority = suggestPriority({ blocages, overdueActions, unteamedMissions, plannedInterventions, siteId })

  return (
    <main className="space-y-4">
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Travail</h1>
            <p className="mt-1 text-sm text-muted-foreground">Ici, je peux savoir ce qui reste à produire et pourquoi.</p>

            <div className="mt-4 rounded-2xl bg-muted/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">À faire maintenant</p>
              <ul className="mt-2 space-y-1 text-sm">
                <SummaryLine count={overdueActions.length} singular="action en retard" plural="actions en retard" tone="red" />
                <SummaryLine count={undatedActions.length} singular="action sans échéance" plural="actions sans échéance" />
                <SummaryLine count={unteamedMissions.length} singular="mission sans équipe" plural="missions sans équipe" />
                <SummaryLine count={blocages.length} singular="blocage ouvert" plural="blocages ouverts" tone="red" />
                <SummaryLine count={plannedInterventions.length} singular="intervention prévue" plural="interventions prévues" />
              </ul>
              {priority ? (
                <p className="mt-3 border-t pt-3 text-sm">
                  <span className="text-muted-foreground">Priorité suggérée : </span>
                  <Link href={priority.href} className="font-medium underline underline-offset-2 hover:no-underline">
                    {priority.label}
                  </Link>
                </p>
              ) : (
                <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">Rien de prioritaire à traiter.</p>
              )}
            </div>
          </div>

          <div className="space-y-3 lg:w-[360px] lg:shrink-0">
            <FilterRow
              label="Par objet"
              items={[
                { label: 'Tout', value: missions.length + plannedInterventions.length + actions.length + blocages.length, active: true },
                { label: 'Missions', value: missions.length },
                { label: 'Interventions', value: plannedInterventions.length },
                { label: 'Actions', value: actions.length },
                { label: 'Réserves', value: blocages.length },
              ]}
            />
            <FilterRow
              label="Par urgence"
              items={[
                { label: 'En retard', value: overdueActions.length, tone: overdueActions.length > 0 ? 'red' : undefined },
                { label: "Aujourd'hui", value: todayActions.length },
                { label: 'Cette semaine', value: weekActions.length },
                { label: 'Sans échéance', value: undatedActions.length },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <SectionTitle icon={ClipboardList} tone="mission" title={`Missions (${missions.length})`} detail="Le niveau supérieur du travail prévu sur ce chantier." />
        {missions.length > 0 ? (
          <div className="mt-4 space-y-2">
            {missions.map((mission) => {
              const missionInterventions = plannedInterventions.filter((intervention) => intervention.mission_id === mission.id)
              const missionActions = sortedActions.filter((action) => matchesMission(action.corps_etat, mission.name))
              const missionBlocages = blocages.filter((blocage) => matchesMission(`${blocage.title} ${blocage.description ?? ''} ${blocage.impact ?? ''}`, mission.name))
              const nextIntervention = [...missionInterventions].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0]
              const hasDetail = missionInterventions.length + missionActions.length + missionBlocages.length > 0

              return (
                <details key={mission.id} className="group rounded-2xl border bg-sky-50/40 dark:bg-sky-950/15">
                  <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold">{mission.name}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {mission.active ? 'En cours' : 'Inactive'} · {countLabel(missionInterventions.length, 'intervention')} · {countLabel(missionActions.length, 'action')} · {countLabel(missionBlocages.length, 'réserve')}
                      </p>
                      {mission.assigned_team_id ? (
                        <p className="mt-0.5 text-sm text-muted-foreground">Équipe affectée</p>
                      ) : (
                        <p className="mt-0.5 text-sm font-medium text-orange-700 dark:text-orange-300">Équipe non affectée</p>
                      )}
                    </div>
                    <span className="flex shrink-0 items-center gap-2 text-sm">
                      <span className="rounded-lg border bg-background px-3 py-1.5 font-medium">Ouvrir</span>
                      {hasDetail && <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />}
                    </span>
                  </summary>

                  <div className="border-t px-4 py-4">
                    {nextIntervention && (
                      <p className="mb-3 text-sm">
                        <span className="text-muted-foreground">Prochaine échéance : </span>
                        {formatDateTime(nextIntervention.scheduled_at)}
                      </p>
                    )}
                    <div className="grid gap-4 lg:grid-cols-3">
                      <MiniList
                        title="Interventions"
                        empty="Aucune intervention planifiée."
                        items={missionInterventions.slice(0, 4).map((intervention) => ({
                          id: intervention.id,
                          label: `${formatDate(intervention.scheduled_for ?? intervention.scheduled_at)} · ${intervention.team?.name ?? 'Équipe non affectée'}`,
                          href: `/interventions/${intervention.id}`,
                        }))}
                      />
                      <MiniList
                        title="Actions"
                        empty="Aucune action rattachée."
                        items={missionActions.slice(0, 4).map((action) => ({ id: action.id, label: action.title, href: `/sites/${siteId}/actions` }))}
                      />
                      <MiniList
                        title="Réserves"
                        empty="Aucune réserve rattachée."
                        items={missionBlocages.slice(0, 4).map((blocage) => ({ id: blocage.id, label: blocage.title, href: `/sites/${siteId}/reserves` }))}
                      />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link href={`/missions/${mission.id}`} className="rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
                        Ouvrir la mission
                      </Link>
                      {!mission.assigned_team_id && (
                        <Link href={`/sites/${siteId}?tab=organisation`} className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-800 hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200">
                          + Affecter une équipe
                        </Link>
                      )}
                    </div>
                  </div>
                </details>
              )
            })}
          </div>
        ) : (
          <EmptyMessage>Aucune mission créée sur ce chantier.</EmptyMessage>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={CalendarClock} tone="intervention" title={`Interventions (${plannedInterventions.length})`} detail="Ce qui est prévu ou reste à exécuter." />
            <div className="mt-4 space-y-2">
              {plannedInterventions.length > 0 ? plannedInterventions.slice(0, 8).map((intervention) => (
                <article key={intervention.id} className="rounded-2xl border bg-amber-50/40 p-4 dark:bg-amber-950/15">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <Link href={`/interventions/${intervention.id}`} className="font-semibold hover:underline">
                        {intervention.mission?.name ?? 'Intervention'}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDateTime(intervention.scheduled_at)} · {interventionStatusLabel(intervention.status)}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">Preuve attendue : réalisation confirmée</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 text-sm">
                      {intervention.team?.name ? (
                        <span className="rounded-lg border bg-background px-3 py-1.5">{intervention.team.name}</span>
                      ) : (
                        <Link href={`/semaine?site=${siteId}`} className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 font-medium text-orange-800 hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200">
                          + Affecter une équipe
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              )) : (
                <EmptyMessage>Aucune intervention ouverte ou planifiée.</EmptyMessage>
              )}
            </div>
          </section>

          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={CheckCircle2} tone="action" title={`Actions (${sortedActions.length})`} detail="Ce qui manque à une action devient une chose à faire." />
            <div className="mt-4 space-y-2">
              {sortedActions.length > 0 ? sortedActions.slice(0, 10).map((action) => {
                const late = Boolean(action.due_date && action.due_date < todayIso)
                return (
                  <article key={action.id} className="rounded-2xl border p-4">
                    <Link href={`/sites/${siteId}/actions`} className="font-semibold hover:underline">
                      {action.title}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {action.corps_etat ? `Mission : ${action.corps_etat}` : 'Mission non renseignée'}
                      {' · '}
                      {action.report_id ? 'Créée lors d’une visite' : 'Origine non renseignée'}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      {action.assigned_to ? (
                        <Chip>{action.assigned_to}</Chip>
                      ) : (
                        <ChipAction href={`/sites/${siteId}/actions`}>+ Affecter un responsable</ChipAction>
                      )}
                      {action.due_date ? (
                        <Chip tone={late ? 'red' : undefined}>
                          {late ? 'En retard depuis le ' : 'Échéance '}
                          {formatDate(action.due_date)}
                        </Chip>
                      ) : (
                        <ChipAction href={`/sites/${siteId}/actions`}>+ Ajouter une échéance</ChipAction>
                      )}
                      {action.converted_to_type ? (
                        <Chip tone="green">Suite donnée</Chip>
                      ) : (
                        <ChipAction href={`/semaine?site=${siteId}`}>Planifier l’intervention</ChipAction>
                      )}
                    </div>
                  </article>
                )
              }) : (
                <EmptyMessage>Aucune action ouverte.</EmptyMessage>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={ShieldAlert} tone="reserve" title={`Réserves et blocages (${blocages.length})`} detail="Ce qui empêche ou ralentit le chantier." />
            <div className="mt-4 space-y-2">
              {blocages.length > 0 ? blocages.map((blocage) => (
                <Link key={blocage.id} href={`/sites/${siteId}/reserves`} className="block rounded-2xl border bg-rose-50/50 p-4 hover:bg-rose-50 dark:bg-rose-950/15 dark:hover:bg-rose-950/25">
                  <p className="font-semibold">{blocage.title}</p>
                  <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">Ouvert depuis le {formatDate(blocage.dateStart)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Bloque : {blocage.impact ?? 'impact non renseigné'}
                  </p>
                </Link>
              )) : (
                <EmptyMessage>Aucun blocage ouvert.</EmptyMessage>
              )}
            </div>
          </section>

          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={Target} title="Échéances" detail="Ce qui approche ou reste à dater." />
            <dl className="mt-4 space-y-2">
              <DeadlineRow label="En retard" value={overdueActions.length} tone={overdueActions.length > 0 ? 'red' : undefined} />
              <DeadlineRow label="Aujourd'hui" value={todayActions.length} />
              <DeadlineRow label="Cette semaine" value={weekActions.length} />
              <DeadlineRow label="Sans échéance" value={undatedActions.length} />
            </dl>
            {undatedActions.length > 0 && (
              <Link href={`/sites/${siteId}/actions`} className="mt-4 block rounded-lg border px-3 py-2 text-center text-sm font-medium hover:bg-muted">
                Dater les {undatedActions.length} éléments
              </Link>
            )}
          </section>
        </aside>
      </section>
    </main>
  )
}

function SummaryLine({ count, singular, plural, tone }: { count: number; singular: string; plural: string; tone?: 'red' }) {
  if (count === 0) return null
  return (
    <li className={cn('tabular-nums', tone === 'red' ? 'font-medium text-rose-700 dark:text-rose-300' : '')}>
      {count} {count > 1 ? plural : singular}
    </li>
  )
}

function FilterRow({ label, items }: { label: string; items: Array<{ label: string; value: number; active?: boolean; tone?: 'red' }> }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5 text-sm">
        {items.map((item) => (
          <span
            key={item.label}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
              item.active ? 'bg-foreground text-background' : 'bg-background text-muted-foreground',
              item.tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300' : '',
            )}
          >
            {item.label}
            <span className="font-semibold tabular-nums">{item.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

const sectionTone = {
  mission: 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900',
  intervention: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900',
  action: 'bg-muted text-foreground ring-border',
  reserve: 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900',
  neutral: 'bg-muted text-muted-foreground ring-border',
} as const

function SectionTitle({
  icon: Icon,
  title,
  detail,
  tone = 'neutral',
}: {
  icon: typeof ClipboardList
  title: string
  detail: string
  tone?: keyof typeof sectionTone
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ring-1', sectionTone[tone])}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function MiniList({ title, items, empty }: { title: string; items: Array<{ id: string; label: string; href: string }>; empty: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5 text-sm">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="hover:underline">{item.label}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'red' | 'green' }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2.5 py-1',
      tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300' : '',
      tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300' : '',
      !tone ? 'text-muted-foreground' : '',
    )}>
      {children}
    </span>
  )
}

function ChipAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center rounded-full border border-dashed px-2.5 py-1 font-medium text-foreground hover:bg-muted">
      {children}
    </Link>
  )
}

function DeadlineRow({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn('text-lg font-semibold tabular-nums', tone === 'red' && value > 0 ? 'text-rose-600 dark:text-rose-300' : '')}>{value}</dd>
    </div>
  )
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <p className="mt-4 rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">{children}</p>
}

function suggestPriority({
  blocages,
  overdueActions,
  unteamedMissions,
  plannedInterventions,
  siteId,
}: {
  blocages: SiteBlocage[]
  overdueActions: SiteActionRow[]
  unteamedMissions: DbMission[]
  plannedInterventions: SupervisorInterventionRow[]
  siteId: string
}): { label: string; href: string } | null {
  if (blocages[0]) {
    return { label: `Lever le blocage « ${blocages[0].title} »`, href: `/sites/${siteId}/reserves` }
  }
  if (overdueActions[0]) {
    return { label: `Traiter l’action en retard « ${overdueActions[0].title} »`, href: `/sites/${siteId}/actions` }
  }
  if (unteamedMissions[0]) {
    return { label: `Affecter une équipe à « ${unteamedMissions[0].name} »`, href: `/sites/${siteId}?tab=organisation` }
  }
  const unteamedIntervention = plannedInterventions.find((intervention) => !intervention.assigned_team_id)
  if (unteamedIntervention) {
    return { label: 'Affecter une équipe à l’intervention prévue', href: `/semaine?site=${siteId}` }
  }
  return null
}

function matchesMission(haystack: string | null, missionName: string): boolean {
  if (!haystack) return false
  return haystack.toLowerCase().includes(missionName.toLowerCase())
}

function isDone(intervention: SupervisorInterventionRow): boolean {
  return intervention.status === 'completed' || intervention.status === 'validated'
}

function countLabel(value: number, noun: string): string {
  return `${value} ${noun}${value > 1 ? 's' : ''}`
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
}
