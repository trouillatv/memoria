import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { HardHat, Wrench, Users, ClipboardList, ChevronRight, NotebookText, AlertTriangle } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { buildFieldPlanning, type PlanningEvent, type PlanningEventKind, type PlanningEventState } from '@/lib/db/field-planning'
import { addDaysLocal } from '@/lib/time/local-date'
import { ScrollToToday } from './ScrollToToday'

export const dynamic = 'force-dynamic'

// Journal terrain = la mémoire temporelle du conducteur (cf.
// docs/foundations/roadmap-terrain-contextuel.md). Décision de design (2026-07-08) :
// PAS de rail vertical qui matérialise le temps — des cartes indépendantes qui
// respirent, rythmées par des séparateurs (✓ Fait / ● Maintenant / ○ Ensuite).
// Le Journal se lit comme une succession de décisions, pas comme une frise.
// Les retards sont ÉPINGLÉS en tête d'aujourd'hui : c'est là qu'ils demandent
// une décision, pas dans le passé où ils n'ont pas eu lieu.

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

// L'ÉTAT se lit d'un coup d'œil : fait / en cours / à venir / annulé.
// (« En retard » n'est plus un chip : les retards vivent dans le bloc épinglé.)
const STATE_META: Record<Exclude<PlanningEventState, 'overdue'>, { label: string; chip: string; icon: string }> = {
  done: { label: 'Fait', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40', icon: '✓' },
  in_progress: { label: 'En cours', chip: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40', icon: '▶' },
  upcoming: { label: 'À venir', chip: 'bg-muted text-muted-foreground border-border', icon: '⏳' },
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

// Le bouton ÉVOLUTIF : son libellé suit le cycle de vie de l'événement
// (Préparer → Continuer → …). Même destination que la carte, mais il DIT
// où on en est au lieu d'une étiquette figée.
function ctaLabel(e: PlanningEvent): string {
  if (e.state === 'in_progress') {
    if (e.kind === 'visite') return 'Continuer la visite'
    if (e.kind === 'intervention') return "Continuer l'intervention"
    return 'Continuer'
  }
  switch (e.kind) {
    case 'visite': return 'Préparer cette visite'
    case 'reunion': return 'Préparer la réunion'
    case 'intervention': return "Préparer l'intervention"
    case 'action': return "Voir l'action"
  }
}

export default async function FieldPlanningPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const planning = await buildFieldPlanning(user.id, user.role, user.organization_id ?? null)
  const { today, events } = planning

  // Les retards sortent de la chronologie : épinglés en tête (ils demandent une
  // décision MAINTENANT), jamais affichés sur leur jour passé (ils n'ont pas eu lieu).
  const overdue = events.filter((e) => e.state === 'overdue')
  const timed = events.filter((e) => e.state !== 'overdue')

  // Regrouper par jour. On INSÈRE aujourd'hui même vide (ancre + état calme) :
  // le conducteur voit toujours où il en est dans le temps.
  const byDay = new Map<string, PlanningEvent[]>()
  for (const e of timed) {
    if (!byDay.has(e.date)) byDay.set(e.date, [])
    byDay.get(e.date)!.push(e)
  }
  if (!byDay.has(today)) byDay.set(today, [])
  const days = Array.from(byDay.keys()).sort()

  return (
    <div className="space-y-6 max-w-md pb-28">
      <header className="space-y-0.5 pt-1">
        <h1 className="text-2xl font-bold leading-tight inline-flex items-center gap-2">
          <NotebookText className="h-6 w-6 text-muted-foreground" strokeWidth={2} />
          Journal
        </h1>
        <p className="text-sm text-muted-foreground">
          Ta journée, du passé récent à ce qui t&apos;attend — tout ce qui est daté sur tes chantiers.
        </p>
      </header>

      {events.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-3xl border border-foreground/[0.06] bg-muted/20 px-5 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
            <NotebookText className="h-5 w-5" strokeWidth={1.5} />
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

                {isToday ? (
                  <TodayRhythm events={dayEvents} overdue={overdue} today={today} />
                ) : dayEvents.length === 0 ? (
                  <p className="pl-1 text-[13px] text-muted-foreground italic">Rien de prévu.</p>
                ) : (
                  <ul className="space-y-2">
                    {dayEvents.map((e) => (
                      <li key={e.id}>
                        <EventRow event={e} muted={date < today} />
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

// ── Aujourd'hui : la journée rythmée, pas une frise ──────────────────────────
// Trois temps séparés par des respirations : ✓ Fait (le passé du jour, atténué),
// ● Maintenant (l'en-cours, sinon le prochain — carte mise en avant + bouton
// évolutif), ○ Ensuite (le reste à venir). Les cartes racontent la journée ;
// les séparateurs donnent le rythme.
function TodayRhythm({ events, overdue, today }: { events: PlanningEvent[]; overdue: PlanningEvent[]; today: string }) {
  const done = events.filter((e) => e.state === 'done' || e.state === 'cancelled')
  const inProgress = events.filter((e) => e.state === 'in_progress')
  const upcoming = events.filter((e) => e.state === 'upcoming')

  // « Maintenant » = ce qui est en cours ; à défaut, le prochain à venir.
  const nowItems = inProgress.length > 0 ? inProgress : upcoming.slice(0, 1)
  const nextItems = inProgress.length > 0 ? upcoming : upcoming.slice(1)

  const empty = overdue.length === 0 && events.length === 0

  return (
    <div className="space-y-4">
      {overdue.length > 0 && (
        <ul className="space-y-2">
          {overdue.map((e) => (
            <li key={e.id}>
              <OverdueRow event={e} today={today} />
            </li>
          ))}
        </ul>
      )}

      {empty ? (
        <p className="pl-1 text-[13px] text-muted-foreground italic">Rien de prévu.</p>
      ) : (
        <>
          {done.length > 0 && (
            <div className="space-y-2">
              <RhythmSep tone="done" label="Fait" />
              <ul className="space-y-2">
                {done.map((e) => (
                  <li key={e.id}>
                    <EventRow event={e} muted />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {nowItems.length > 0 && (
            <div className="space-y-2">
              <RhythmSep tone="now" label="Maintenant" />
              <ul className="space-y-2">
                {nowItems.map((e, idx) => (
                  <li key={e.id}>{idx === 0 ? <HeroCard event={e} /> : <EventRow event={e} />}</li>
                ))}
              </ul>
            </div>
          )}

          {nextItems.length > 0 && (
            <div className="space-y-2">
              <RhythmSep tone="next" label="Ensuite" />
              <ul className="space-y-2">
                {nextItems.map((e) => (
                  <li key={e.id}>
                    <EventRow event={e} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Séparateur de rythme — donne le tempo de la journée sans matérialiser le temps.
function RhythmSep({ tone, label }: { tone: 'done' | 'now' | 'next'; label: string }) {
  const glyph = tone === 'done' ? '✓' : tone === 'now' ? '●' : '○'
  const color =
    tone === 'now'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-muted-foreground'
  const rule = tone === 'now' ? 'bg-emerald-500/25' : 'bg-foreground/[0.06]'
  return (
    <div className="flex items-center gap-2 pt-1" aria-hidden>
      <span className={`text-[10px] ${color}`}>{glyph}</span>
      <span className={`text-[11px] font-bold uppercase tracking-[0.08em] ${color}`}>{label}</span>
      <span className={`h-px flex-1 rounded ${rule}`} />
    </div>
  )
}

// La carte du MOMENT : même lecture que les autres, mais mise en avant + bouton
// évolutif. C'est la seule carte qui « appelle » — les autres racontent.
function HeroCard({ event }: { event: PlanningEvent }) {
  const Icon = KIND_ICON[event.kind]
  const sub = [event.siteName, event.teamName].filter(Boolean).join(' · ')
  return (
    <div className="rounded-2xl border border-emerald-200 bg-card p-3.5 shadow-sm ring-2 ring-emerald-500/10 dark:border-emerald-900/50">
      <div className="flex items-center gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          <Icon className="h-[21px] w-[21px]" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[15px] font-semibold leading-snug">{event.title}</span>
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
      </div>
      <Link
        href={event.href}
        className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors active:bg-emerald-700"
      >
        {ctaLabel(event)}
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

// Retard épinglé — hors chronologie, en tête : il demande une décision aujourd'hui.
function OverdueRow({ event, today }: { event: PlanningEvent; today: string }) {
  const sub = [KIND_LABEL[event.kind], event.siteName].filter(Boolean).join(' · ')
  const due = dayHeading(event.date, today).toLowerCase()
  return (
    <Link
      href={event.href}
      className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50/60 px-3.5 py-3 dark:border-red-900/40 dark:bg-red-950/20"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
        <AlertTriangle className="h-[17px] w-[17px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium leading-snug">{event.title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {sub} · échéance {due}
        </span>
      </span>
      <span className="shrink-0 text-[11px] font-bold text-red-600 dark:text-red-400">En retard</span>
    </Link>
  )
}

function EventRow({ event, muted = false }: { event: PlanningEvent; muted?: boolean }) {
  const Icon = KIND_ICON[event.kind]
  const st = STATE_META[event.state as Exclude<PlanningEventState, 'overdue'>] ?? STATE_META.upcoming
  // Sous-titre : chantier · [équipe]. L'heure a son propre badge à droite.
  const sub = [event.siteName, event.teamName].filter(Boolean).join(' · ')
  return (
    <Link
      href={event.href}
      className={`flex items-center gap-3.5 rounded-2xl border border-foreground/[0.07] bg-card px-3.5 py-3.5 shadow-sm transition-colors active:bg-muted/40 ${
        muted ? 'opacity-75' : ''
      }`}
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
