import Link from 'next/link'
import type { ReactNode } from 'react'
import { CalendarDays, Clock, Layers3, ListOrdered, Route, ShieldAlert, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cycleStatusLabel } from '@/lib/chantier/labels'
import type { SiteBlocage } from '@/lib/db/site-blocages'
import type { SupervisorInterventionRow } from '@/lib/db/interventions'
import type { CycleSlot, PlanningCycle } from '@/lib/db/planning-cycles'
import type { OverviewEventInput } from '@/lib/chantier/overview-projections'
import type { DbMission, DbTeam } from '@/types/db'

interface PlanningWorkspaceProps {
  siteId: string
  nextEvent: OverviewEventInput | null
  interventions: SupervisorInterventionRow[]
  missions: DbMission[]
  blocages: SiteBlocage[]
  cycles: PlanningCycle[]
  teams: DbTeam[]
}

const WEEKDAYS = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.']
const WEEKDAYS_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

export function PlanningWorkspace({
  siteId,
  nextEvent,
  interventions,
  missions,
  blocages,
  cycles,
  teams,
}: PlanningWorkspaceProps) {
  const week = getCurrentWeek()
  const interventionsThisWeek = interventions.filter((intervention) => {
    const date = intervention.scheduled_for ?? isoDate(intervention.scheduled_at)
    return date >= week[0].iso && date <= week[6].iso
  })
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const unassignedInterventions = interventionsThisWeek.filter((intervention) => !intervention.assigned_team_id)
  const unteamedMissions = missions.filter((mission) => !mission.assigned_team_id)
  const unpublishedCycles = cycles.filter((cycle) => cycle.status !== 'published')
  const activeBlocages = blocages.filter((blocage) => blocage.dateEnd === null)
  const scheduled = [...interventionsThisWeek].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))

  return (
    <main className="space-y-4">
      <section className="rounded-[22px] border bg-card px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Planning</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ici, je peux organiser les engagements et les ressources dans le temps.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full border px-3 py-1.5 text-muted-foreground">Semaine précédente</span>
            <span className="rounded-full bg-foreground px-3 py-1.5 text-background">{formatWeekRange(week)}</span>
            <span className="rounded-full border px-3 py-1.5 text-muted-foreground">Semaine suivante</span>
            <Link href={`/semaine?site=${siteId}`} className="rounded-full border px-3 py-1.5 font-medium hover:bg-muted">
              Ouvrir la semaine
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={CalendarDays} title="Semaine" detail="Lundi à dimanche, avec les interventions connues." />
            <div className="mt-4 grid gap-2 lg:grid-cols-7">
              {week.map((day) => {
                const dayInterventions = interventionsThisWeek.filter((intervention) => (intervention.scheduled_for ?? isoDate(intervention.scheduled_at)) === day.iso)
                return (
                  <div
                    key={day.iso}
                    className={cn(
                      'rounded-2xl border p-3',
                      dayInterventions.length > 0 ? 'min-h-[140px] bg-card' : 'min-h-[76px] bg-muted/20',
                    )}
                  >
                    <p className="text-sm font-semibold">{day.label}</p>
                    <p className="text-xs text-muted-foreground">{day.shortDate}</p>
                    <div className="mt-2 space-y-2">
                      {dayInterventions.map((intervention) => (
                        <Link
                          key={intervention.id}
                          href={`/interventions/${intervention.id}`}
                          className="block rounded-xl border border-amber-200 bg-amber-50 p-2 text-sm hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
                        >
                          <p className="font-medium">{formatTime(intervention.scheduled_at)}</p>
                          <p className="mt-0.5 text-xs">{intervention.mission?.name ?? 'Intervention'}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{intervention.team?.name ?? 'Non affectée'}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* La grille montre la forme de la semaine ; la liste montre l'enchaînement.
              Sur un chantier peu chargé, c'est la liste qui se lit. */}
          <div className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={ListOrdered} title="Liste de la semaine" detail="Le même contenu, lu dans l’ordre." />
            <div className="mt-4 divide-y rounded-2xl border">
              {scheduled.length > 0 ? scheduled.map((intervention) => (
                <Link key={intervention.id} href={`/interventions/${intervention.id}`} className="flex flex-col gap-1 p-3 hover:bg-muted/40 md:flex-row md:items-center md:gap-4">
                  <span className="w-44 shrink-0 text-sm font-medium">{formatDayAndTime(intervention.scheduled_at)}</span>
                  <span className="min-w-0 flex-1 text-sm">{intervention.mission?.name ?? 'Intervention'}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">{intervention.team?.name ?? 'Non affectée'}</span>
                </Link>
              )) : (
                <Empty>Rien de planifié cette semaine.</Empty>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <SummaryCard
            title="Cette semaine"
            rows={[
              ['Interventions', String(interventionsThisWeek.length)],
              ['Visites', nextEvent?.kind === 'visit' ? '1' : '0'],
              ['Réunions', nextEvent?.kind === 'meeting' ? '1' : '0'],
              ['Équipes prévues', String(new Set(interventionsThisWeek.map((i) => i.assigned_team_id).filter(Boolean)).size)],
            ]}
          />

          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={Layers3} title="Éléments non affectés" detail="Ce qui doit encore être placé." />
            <div className="mt-4 space-y-2">
              <LooseItem label="Interventions sans équipe" value={unassignedInterventions.length} href={`/semaine?site=${siteId}`} />
              <LooseItem label="Missions sans équipe" value={unteamedMissions.length} href={`/sites/${siteId}?tab=organisation`} />
              <LooseItem label="Roulements à publier" value={unpublishedCycles.length} href={`/sites/${siteId}/roulements`} />
            </div>
          </section>

          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <SectionTitle icon={Users} title="Équipes" detail="Affectations visibles cette semaine." />
            <div className="mt-4 space-y-2">
              {teamsUsedThisWeek(interventionsThisWeek, teamById).length > 0 ? teamsUsedThisWeek(interventionsThisWeek, teamById).map((team) => (
                <div key={team.id} className="flex items-center justify-between gap-3 rounded-2xl border p-3">
                  <p className="font-medium">{team.name}</p>
                  <p className="shrink-0 text-sm text-muted-foreground">{team.count} intervention{team.count > 1 ? 's' : ''}</p>
                </div>
              )) : (
                <Empty>Aucune équipe affectée cette semaine.</Empty>
              )}
            </div>
          </section>
        </aside>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={Route} title="Roulements disponibles" detail="Cycles publiés ou préparés pour ce chantier." />
          <div className="mt-4 space-y-2">
            {cycles.length > 0 ? cycles.map((cycle) => {
              const mission = missions.find((item) => item.id === cycle.missionId)
              const workedSlots = cycle.slots.filter((slot) => slot.state === 'work')
              const cycleTeams = [...new Set(workedSlots.map((slot) => slot.teamId))]
                .map((teamId) => teamById.get(teamId)?.name)
                .filter((name): name is string => Boolean(name))

              return (
                <div key={cycle.id} className="rounded-2xl border bg-sky-50/40 p-4 dark:bg-sky-950/15">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{cycle.name}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{mission?.name ?? 'Mission non renseignée'}</p>
                    </div>
                    <span className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      cycle.status === 'published'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                        : 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300',
                    )}>
                      {cycleStatusLabel(cycle.status)}
                    </span>
                  </div>

                  {/* « 2 cases travaillées » ne veut rien dire sur un chantier :
                      Guillaume a besoin des jours et des heures réels. */}
                  <p className="mt-3 text-sm">{describeSlots(workedSlots)}</p>
                  {cycleTeams.length > 0 && (
                    <p className="mt-1 text-sm text-muted-foreground">Équipe : {cycleTeams.join(', ')}</p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/sites/${siteId}/roulements/${cycle.id}`} className="rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
                      Ouvrir
                    </Link>
                    <Link href={`/semaine?site=${siteId}`} className="rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
                      Utiliser pour planifier
                    </Link>
                  </div>
                </div>
              )
            }) : (
              <Empty>Aucun roulement configuré.</Empty>
            )}
          </div>
        </section>

        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={ShieldAlert} title="Contraintes" detail="Ce qui peut empêcher d’exécuter le planning." />
          <div className="mt-4 space-y-2">
            {activeBlocages.length > 0 ? activeBlocages.map((blocage) => (
              <Link key={blocage.id} href={`/sites/${siteId}/reserves`} className="block rounded-2xl border bg-rose-50/50 p-4 hover:bg-rose-50 dark:bg-rose-950/15 dark:hover:bg-rose-950/25">
                <p className="font-semibold">{blocage.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{blocage.impact ?? blocage.description ?? 'Impact non renseigné'}</p>
              </Link>
            )) : (
              <Empty>Aucune contrainte ouverte.</Empty>
            )}
          </div>
        </section>
      </section>
    </main>
  )
}

/** Traduit les cases d'un cycle en jours et heures lisibles.
 *  Une plage régulière se dit « Lundi–vendredi · 06:00–14:00 » ;
 *  sinon on énumère chaque jour avec son horaire. */
function describeSlots(slots: CycleSlot[]): string {
  if (slots.length === 0) return 'Aucun jour travaillé.'

  const weekdays = [...new Set(slots.map((slot) => slot.weekday))].sort((a, b) => a - b)
  const ranges = [...new Set(slots.map((slot) => timeRange(slot)))]

  if (ranges.length === 1 && weekdays.length > 1 && isContiguous(weekdays)) {
    const first = WEEKDAYS_LONG[weekdays[0] - 1]
    const last = WEEKDAYS_LONG[weekdays[weekdays.length - 1] - 1]
    return ranges[0] === 'horaire non renseigné'
      ? `${first}–${last.toLowerCase()}`
      : `${first}–${last.toLowerCase()} · ${ranges[0]}`
  }

  return weekdays
    .map((weekday) => {
      const daySlots = slots.filter((slot) => slot.weekday === weekday)
      const dayRanges = [...new Set(daySlots.map((slot) => timeRange(slot)))].join(', ')
      return `${WEEKDAYS_LONG[weekday - 1]} ${dayRanges}`
    })
    .join(' · ')
}

function timeRange(slot: CycleSlot): string {
  if (!slot.startTime) return 'horaire non renseigné'
  return slot.endTime ? `${slot.startTime}–${slot.endTime}` : slot.startTime
}

function isContiguous(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value === values[index - 1] + 1)
}

function SectionTitle({ icon: Icon, title, detail }: { icon: typeof Clock; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function SummaryCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="rounded-[22px] border bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <dl className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-sm font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function LooseItem({ label, value, href }: { label: string; value: number; href: string }) {
  const pending = value > 0
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center justify-between gap-3 rounded-2xl border p-3 hover:bg-muted/40',
        pending ? 'border-orange-200 bg-orange-50/60 dark:border-orange-900 dark:bg-orange-950/20' : '',
      )}
    >
      <span className={cn('text-sm', pending ? 'font-medium text-orange-900 dark:text-orange-200' : 'text-muted-foreground')}>{label}</span>
      <span className={cn('text-lg font-semibold tabular-nums', pending ? 'text-orange-600 dark:text-orange-300' : 'text-emerald-600 dark:text-emerald-400')}>{value}</span>
    </Link>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">{children}</p>
}

function teamsUsedThisWeek(interventions: SupervisorInterventionRow[], teamById: Map<string, DbTeam>) {
  const counts = new Map<string, number>()
  for (const intervention of interventions) {
    if (!intervention.assigned_team_id) continue
    counts.set(intervention.assigned_team_id, (counts.get(intervention.assigned_team_id) ?? 0) + 1)
  }
  return [...counts.entries()].map(([id, count]) => ({
    id,
    name: teamById.get(id)?.name ?? interventions.find((item) => item.assigned_team_id === id)?.team?.name ?? 'Équipe',
    count,
  }))
}

function getCurrentWeek() {
  const now = new Date()
  const day = now.getDay() === 0 ? 7 : now.getDay()
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(now.getDate() - day + 1)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return {
      iso: isoDate(date.toISOString()),
      label: WEEKDAYS[index],
      shortDate: date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
    }
  })
}

function formatWeekRange(week: ReturnType<typeof getCurrentWeek>): string {
  return `${week[0].shortDate} - ${week[6].shortDate}`
}

function isoDate(value: string): string {
  return value.slice(0, 10)
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatDayAndTime(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
}
