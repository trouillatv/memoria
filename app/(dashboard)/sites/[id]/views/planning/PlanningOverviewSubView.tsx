import Link from 'next/link'
import type { ReactNode } from 'react'
import { CalendarClock, CalendarDays, Flag, HardHat } from 'lucide-react'
import type { SitePlanningItem } from '@/lib/db/site-planning-items'
import type { SiteDeadline } from '@/lib/db/site-deadlines'
import type { OverviewEventInput } from '@/lib/chantier/overview-projections'
import { SectionTitle, Empty } from './PlanningUI'
import { splitDatedTitle } from './dated-title'

interface PlanningOverviewSubViewProps {
  siteId: string
  planningItems: SitePlanningItem[]
  nextEvent: OverviewEventInput | null
  deadlines: SiteDeadline[]
}

const dayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' })
const dayFullYearFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
function fmtDay(iso: string): string {
  return dayFmt.format(new Date(iso + 'T00:00:00Z'))
}
function fmtDayFullYear(iso: string): string {
  return dayFullYearFmt.format(new Date(iso + 'T00:00:00Z'))
}

/**
 * Agrège Travaux (site_planning_items) / Agenda (getPlanningTimeline) /
 * Échéances (site_deadlines) SANS jamais en devenir la source de vérité —
 * une vérité métier par primitive, plusieurs projections produit.
 */
export function PlanningOverviewSubView({ siteId, planningItems, nextEvent, deadlines }: PlanningOverviewSubViewProps) {
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Noumea', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const tasks = planningItems.filter((i) => i.kind === 'task')
  const milestones = planningItems.filter((i) => i.kind === 'milestone')
  const nextTask = upcoming(tasks, todayIso)
  const nextMilestone = upcoming(milestones, todayIso)
  const period = coveredPeriod(tasks)
  const lastMilestone = [...milestones].filter((m) => m.plannedStart).sort((a, b) => b.plannedStart!.localeCompare(a.plannedStart!))[0] ?? null
  const activeDeadlines = deadlines.length

  return (
    <main className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2">
        <OverviewCard icon={HardHat} title="Prochaine étape">
          {nextTask ? (
            <div>
              <p className="text-sm font-medium text-foreground">{nextTask.title}</p>
              <p className="text-sm text-muted-foreground tabular-nums">{fmtDayFullYear(nextTask.plannedStart!)}</p>
            </div>
          ) : (
            <Empty>Aucune étape à venir documentée.</Empty>
          )}
        </OverviewCard>

        <OverviewCard icon={HardHat} title="Planning travaux">
          {planningItems.length > 0 ? (
            <div className="space-y-1">
              <p className="text-sm text-foreground">
                {tasks.length} tâche{tasks.length > 1 ? 's' : ''}
                {period && ` · ${fmtDay(period.start)} → ${fmtDayFullYear(period.end)}`}
              </p>
              {milestones.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  <p>{milestones.length} jalon{milestones.length > 1 ? 's' : ''}</p>
                  {lastMilestone && lastMilestone.plannedStart && (() => {
                    const { title, date } = splitDatedTitle(lastMilestone.title, lastMilestone.plannedStart)
                    return (
                      <>
                        <p>Dernier · {title}</p>
                        <p className="tabular-nums">{date}</p>
                      </>
                    )
                  })()}
                </div>
              )}
              <Link href={`/sites/${siteId}?tab=planning&plantab=travaux`} className="mt-1 inline-block text-sm underline decoration-dotted underline-offset-2 hover:text-foreground">
                Voir le détail
              </Link>
            </div>
          ) : (
            <Empty>Aucun planning de travaux documenté pour ce chantier.</Empty>
          )}
        </OverviewCard>

        <OverviewCard icon={Flag} title="Prochain jalon">
          {nextMilestone && nextMilestone.plannedStart ? (() => {
            const { title, date } = splitDatedTitle(nextMilestone.title, nextMilestone.plannedStart!)
            return (
              <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="text-sm text-muted-foreground tabular-nums">{date}</p>
              </div>
            )
          })() : (
            <Empty>Aucun jalon à venir documenté.</Empty>
          )}
        </OverviewCard>

        <OverviewCard icon={CalendarDays} title="Agenda">
          {nextEvent ? (
            <div>
              <p className="text-sm text-foreground">{nextEvent.title}</p>
              <Link href={`/sites/${siteId}?tab=planning&plantab=agenda`} className="mt-1 inline-block text-sm underline decoration-dotted underline-offset-2 hover:text-foreground">
                Voir l'agenda
              </Link>
            </div>
          ) : (
            <Empty>Rien de planifié prochainement.</Empty>
          )}
        </OverviewCard>

        <OverviewCard icon={CalendarClock} title="Échéances">
          {activeDeadlines > 0 ? (
            <div>
              <p className="text-sm text-foreground">{activeDeadlines} échéance{activeDeadlines > 1 ? 's' : ''} active{activeDeadlines > 1 ? 's' : ''}</p>
              <Link href={`/sites/${siteId}?tab=planning&plantab=echeances`} className="mt-1 inline-block text-sm underline decoration-dotted underline-offset-2 hover:text-foreground">
                Voir le détail
              </Link>
            </div>
          ) : (
            <Empty>Aucune échéance active.</Empty>
          )}
        </OverviewCard>
      </section>
    </main>
  )
}

function OverviewCard({ icon, title, children }: { icon: Parameters<typeof SectionTitle>[0]['icon']; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border bg-card p-5 shadow-sm">
      <SectionTitle icon={icon} title={title} detail="" />
      <div className="mt-3">{children}</div>
    </section>
  )
}

function upcoming(items: SitePlanningItem[], todayIso: string): SitePlanningItem | null {
  return items
    .filter((i) => i.plannedStart && i.plannedStart >= todayIso)
    .sort((a, b) => a.plannedStart!.localeCompare(b.plannedStart!))[0] ?? null
}

function coveredPeriod(items: SitePlanningItem[]): { start: string; end: string } | null {
  const dates = items.flatMap((i) => [i.plannedStart, i.plannedEnd]).filter((d): d is string => Boolean(d))
  if (dates.length === 0) return null
  return { start: dates.reduce((a, b) => (a < b ? a : b)), end: dates.reduce((a, b) => (a > b ? a : b)) }
}
