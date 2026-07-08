import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { HardHat, Wrench, Users, ClipboardList, ChevronRight, CalendarRange } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { buildFieldPlanning, type PlanningEvent, type PlanningEventKind, type PlanningEventState } from '@/lib/db/field-planning'
import { addDaysLocal } from '@/lib/time/local-date'
import { ScrollToToday } from './ScrollToToday'

export const dynamic = 'force-dynamic'

// Planning terrain = la mémoire temporelle du conducteur (cf.
// docs/foundations/roadmap-terrain-contextuel.md). Une timeline CONTINUE façon
// agenda : hier / aujourd'hui / demain / à venir, chaque ligne = un événement
// daté (visite · intervention · réunion · action) portant son ÉTAT. On ne filtre
// pas par type — le TEMPS fait le travail.

const TODAY_ANCHOR = 'planning-today'

const KIND_ICON: Record<PlanningEventKind, LucideIcon> = {
  visite: HardHat,
  intervention: Wrench,
  reunion: Users,
  action: ClipboardList,
}
const KIND_LABEL: Record<PlanningEventKind, string> = {
  visite: 'Visite',
  intervention: 'Intervention',
  reunion: 'Réunion',
  action: 'Action',
}

// L'ÉTAT se lit d'un coup d'œil : fait / en cours / à venir / en retard / annulé.
const STATE_META: Record<PlanningEventState, { label: string; chip: string; icon: string }> = {
  done: { label: 'Terminé', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40', icon: '✓' },
  in_progress: { label: 'En cours', chip: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40', icon: '▶' },
  upcoming: { label: 'À venir', chip: 'bg-muted text-muted-foreground border-border', icon: '⏳' },
  overdue: { label: 'En retard', chip: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/40', icon: '⚠' },
  cancelled: { label: 'Annulé', chip: 'bg-muted/60 text-muted-foreground border-border line-through', icon: '✕' },
}

function dayHeading(dateIso: string, todayIso: string): string {
  if (dateIso === todayIso) return "Aujourd'hui"
  if (dateIso === addDaysLocal(todayIso, 1)) return 'Demain'
  if (dateIso === addDaysLocal(todayIso, -1)) return 'Hier'
  // Date civile pure : ancrage midi UTC pour éviter toute bascule de fuseau.
  return new Date(`${dateIso}T12:00:00.000Z`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

export default async function FieldPlanningPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const planning = await buildFieldPlanning(user.id, user.role, user.organization_id ?? null)
  const { today, events } = planning

  // Regrouper par jour. On INSÈRE aujourd'hui même vide (ancre + état calme) :
  // le conducteur voit toujours où il en est dans le temps.
  const byDay = new Map<string, PlanningEvent[]>()
  for (const e of events) {
    if (!byDay.has(e.date)) byDay.set(e.date, [])
    byDay.get(e.date)!.push(e)
  }
  if (!byDay.has(today)) byDay.set(today, [])
  const days = Array.from(byDay.keys()).sort()

  return (
    <div className="space-y-6 max-w-md pb-28">
      <header className="space-y-0.5 pt-1">
        <h1 className="text-2xl font-bold leading-tight inline-flex items-center gap-2">
          <CalendarRange className="h-6 w-6 text-muted-foreground" strokeWidth={2} />
          Planning
        </h1>
        <p className="text-sm text-muted-foreground">
          Ta journée, du passé récent à ce qui t&apos;attend — tout ce qui est daté sur tes chantiers.
        </p>
      </header>

      {events.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-3xl border border-foreground/[0.06] bg-muted/20 px-5 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
            <CalendarRange className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <p className="text-sm font-medium">Rien de daté sur cette période.</p>
          <p className="text-[13px] text-muted-foreground">
            Les visites, interventions, réunions et actions planifiées apparaîtront ici, jour après jour.
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          {days.map((date) => {
            const dayEvents = byDay.get(date) ?? []
            const isToday = date === today
            return (
              <section key={date} id={isToday ? TODAY_ANCHOR : undefined} className="scroll-mt-20">
                <div className="mb-2.5 flex items-center gap-2">
                  <h2
                    className={`text-sm font-semibold tracking-tight first-letter:uppercase ${
                      isToday ? 'text-emerald-600' : 'text-foreground/80'
                    }`}
                  >
                    {dayHeading(date, today)}
                  </h2>
                  {isToday && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                  <span className="h-px flex-1 bg-foreground/[0.06]" />
                </div>

                {dayEvents.length === 0 ? (
                  <p className="pl-1 text-[13px] text-muted-foreground italic">Rien de prévu.</p>
                ) : (
                  <ul className="space-y-2">
                    {dayEvents.map((e) => (
                      <li key={e.id}>
                        <EventRow event={e} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      <ScrollToToday anchorId={TODAY_ANCHOR} />
    </div>
  )
}

function EventRow({ event }: { event: PlanningEvent }) {
  const Icon = KIND_ICON[event.kind]
  const st = STATE_META[event.state]
  // Sous-titre : chantier · [équipe]. L'heure a son propre badge à droite.
  const sub = [event.siteName, event.teamName].filter(Boolean).join(' · ')
  return (
    <Link
      href={event.href}
      className="flex items-center gap-3.5 rounded-2xl border border-foreground/[0.07] bg-card px-3.5 py-3.5 shadow-sm transition-colors active:bg-muted/40"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted/60 text-foreground/70">
        <Icon className="h-[21px] w-[21px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-medium leading-snug">{event.title}</span>
          {event.timeLabel && (
            <span className="shrink-0 text-[13px] font-medium tabular-nums text-muted-foreground">{event.timeLabel}</span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {KIND_LABEL[event.kind]}
          </span>
          {sub && <span className="min-w-0 truncate text-[13px] text-muted-foreground">· {sub}</span>}
        </span>
      </span>
      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.chip}`}>
        <span aria-hidden>{st.icon}</span>
        {st.label}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}
