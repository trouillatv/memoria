import Link from 'next/link'
import { CalendarDays, Clock, Layers3, Route, ShieldAlert, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SiteBlocage } from '@/lib/db/site-blocages'
import type { SupervisorInterventionRow } from '@/lib/db/interventions'
import type { PlanningCycle } from '@/lib/db/planning-cycles'
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
  const activeBlocages = blocages.filter((blocage) => blocage.dateEnd === null)

  return (
    <main className="space-y-5">
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

      <section className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={CalendarDays} title="Semaine" detail="Lundi à dimanche, avec les interventions connues." />
          <div className="mt-4 grid gap-2 lg:grid-cols-7">
            {week.map((day) => {
              const dayInterventions = interventionsThisWeek.filter((intervention) => (intervention.scheduled_for ?? isoDate(intervention.scheduled_at)) === day.iso)
              return (
                <div key={day.iso} className="min-h-[210px] rounded-2xl border bg-muted/20 p-3">
                  <p className="text-sm font-semibold">{day.label}</p>
                  <p className="text-xs text-muted-foreground">{day.shortDate}</p>
                  <div className="mt-3 space-y-2">
                    {dayInterventions.length > 0 ? dayInterventions.map((intervention) => (
                      <Link key={intervention.id} href={`/interventions/${intervention.id}`} className="block rounded-xl border bg-background p-2 text-sm hover:bg-muted">
                        <p className="font-medium">{intervention.mission?.name ?? 'Intervention'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{slotLabel(intervention.slot)} · {intervention.team?.name ?? 'Non affectée'}</p>
                      </Link>
                    )) : (
                      <p className="text-xs text-muted-foreground">Rien de planifié.</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <aside className="space-y-5">
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
            <SectionTitle icon={Users} title="Équipes" detail="Affectations visibles cette semaine." />
            <div className="mt-4 space-y-3">
              {teamsUsedThisWeek(interventionsThisWeek, teamById).length > 0 ? teamsUsedThisWeek(interventionsThisWeek, teamById).map((team) => (
                <div key={team.id} className="rounded-2xl border p-3">
                  <p className="font-semibold">{team.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{team.count} intervention{team.count > 1 ? 's' : ''} cette semaine</p>
                </div>
              )) : (
                <Empty>Aucune équipe affectée cette semaine.</Empty>
              )}
            </div>
          </section>
        </aside>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={Route} title="Roulements disponibles" detail="Cycles publiés ou préparés pour ce chantier." />
          <div className="mt-4 space-y-3">
            {cycles.length > 0 ? cycles.map((cycle) => {
              const mission = missions.find((item) => item.id === cycle.missionId)
              const workedSlots = cycle.slots.filter((slot) => slot.state === 'work')
              return (
                <div key={cycle.id} className="rounded-2xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{cycle.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {mission?.name ?? 'Mission non renseignée'} · {cycle.cycleLengthWeeks} semaine{cycle.cycleLengthWeeks > 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', cycle.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700')}>
                      {cycle.status === 'published' ? 'Publié' : cycle.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {workedSlots.length} case{workedSlots.length > 1 ? 's' : ''} travaillée{workedSlots.length > 1 ? 's' : ''}.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/sites/${siteId}/roulements/${cycle.id}`} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                      Ouvrir
                    </Link>
                    <Link href={`/semaine?site=${siteId}`} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
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
          <div className="mt-4 space-y-3">
            {activeBlocages.length > 0 ? activeBlocages.map((blocage) => (
              <Link key={blocage.id} href={`/sites/${siteId}/reserves`} className="block rounded-2xl border p-4 hover:bg-muted/40">
                <p className="font-semibold">{blocage.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{blocage.impact ?? blocage.description ?? 'Impact non renseigné'}</p>
              </Link>
            )) : (
              <Empty>Aucune contrainte ouverte.</Empty>
            )}
          </div>
        </section>

        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={Layers3} title="Éléments non affectés" detail="Ce qui doit encore être placé." />
          <div className="mt-4 space-y-3">
            <LooseItem label="Interventions sans équipe" value={unassignedInterventions.length} href={`/semaine?site=${siteId}`} />
            <LooseItem label="Missions sans équipe" value={missions.filter((mission) => !mission.assigned_team_id).length} href={`/sites/${siteId}?tab=organisation`} />
            <LooseItem label="Roulements à publier" value={cycles.filter((cycle) => cycle.status !== 'published').length} href={`/sites/${siteId}/roulements`} />
          </div>
        </section>
      </section>
    </main>
  )
}

function SectionTitle({ icon: Icon, title, detail }: { icon: typeof Clock; title: string; detail: string }) {
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
  return (
    <Link href={href} className="flex items-center justify-between gap-3 rounded-2xl border p-3 hover:bg-muted/40">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-lg font-semibold tabular-nums', value > 0 ? 'text-orange-600' : 'text-emerald-600')}>{value}</span>
    </Link>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
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
      label: ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'][index],
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

function slotLabel(slot: string | null): string {
  if (slot === 'morning') return 'Matin'
  if (slot === 'afternoon') return 'Après-midi'
  if (slot === 'evening') return 'Soir'
  return 'Horaire non renseigné'
}
