import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { HardHat, Wrench, Users, ClipboardList, ChevronRight, NotebookText, AlertTriangle, Check } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { buildFieldPlanning, type PlanningEvent, type PlanningEventKind, type PlanningEventState } from '@/lib/db/field-planning'
import { detectClosingProofWindows } from '@/lib/db/site-memory-signals'
import { addDaysLocal } from '@/lib/time/local-date'
import { ScrollToToday } from './ScrollToToday'
import { DoneToday } from './DoneToday'

export const dynamic = 'force-dynamic'

// Journal terrain = LE COMPAGNON DE LA JOURNÉE du conducteur (cf.
// docs/foundations/roadmap-terrain-contextuel.md). Décision de design (2026-07-08,
// arbitrage V2) : cet écran ne doit pas se lire comme une liste d'événements mais
// RACONTER la journée. Trois exigences tenues ici :
//   1. HIÉRARCHIE : Maintenant > Ensuite > Fait. Le fait est replié, l'urgent est
//      épinglé en tête, le prochain est vivant.
//   2. IDENTITÉ : chaque type a sa couleur (visite=emerald, intervention=violet,
//      réunion=sky, action=amber). Le temps (l'heure) est le personnage principal.
//   3. LIEN AVEC MEMORIA : la carte du moment porte « Avant de partir » (réserves,
//      réunion, actions) et un bouton évolutif — elle donne envie d'ouvrir.
// Le chantier est la vedette de chaque carte, pas le type.

const TODAY_ANCHOR = 'planning-today'
const NOUMEA_TZ = 'Pacific/Noumea'

// ── Identité par type : une couleur, une icône, un mot ───────────────────────
interface KindTheme {
  Icon: LucideIcon
  label: string
  /** Pastille icône (fond pâle + icône colorée) — l'identité visible du type. */
  chip: string
  /** Fond de pastille sur la carte du moment (plus présent). */
  heroChip: string
  /** Accent CTA / mise en avant de la carte vivante. */
  accentBtn: string
  accentRing: string
  accentBorder: string
}
const KIND_THEME: Record<PlanningEventKind, KindTheme> = {
  visite: {
    Icon: HardHat, label: 'Visite',
    chip: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300',
    heroChip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    accentBtn: 'bg-emerald-600 active:bg-emerald-700',
    accentRing: 'ring-emerald-500/10', accentBorder: 'border-emerald-200 dark:border-emerald-900/50',
  },
  intervention: {
    Icon: Wrench, label: 'Intervention',
    chip: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300',
    heroChip: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
    accentBtn: 'bg-violet-600 active:bg-violet-700',
    accentRing: 'ring-violet-500/10', accentBorder: 'border-violet-200 dark:border-violet-900/50',
  },
  reunion: {
    Icon: Users, label: 'Réunion',
    chip: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300',
    heroChip: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
    accentBtn: 'bg-sky-600 active:bg-sky-700',
    accentRing: 'ring-sky-500/10', accentBorder: 'border-sky-200 dark:border-sky-900/50',
  },
  action: {
    Icon: ClipboardList, label: 'Action',
    chip: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300',
    heroChip: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
    accentBtn: 'bg-amber-600 active:bg-amber-700',
    accentRing: 'ring-amber-500/10', accentBorder: 'border-amber-200 dark:border-amber-900/50',
  },
}

// L'heure — personnage principal du Journal. Deux sources honnêtes :
//  · interventions → `timeLabel` (heure de prestation, déjà en heure locale) ;
//  · visites / réunions → instant réel `at`, converti en heure de Nouméa.
//  · actions → « de la journée » (pas d'heure).
const HOUR_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: NOUMEA_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
})
function hourFromInstant(at: string | null): string | null {
  if (!at) return null
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  const parts = HOUR_FMT.formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}
function displayTime(e: PlanningEvent): string | null {
  if (e.kind === 'intervention') {
    const t = e.timeLabel?.trim()
    return t && t !== '—' ? t : null
  }
  if (e.kind === 'action') return null
  return hourFromInstant(e.at)
}

// Le CHANTIER est la vedette : titre = nom du site ; l'objet devient le sous-titre.
function headlineOf(e: PlanningEvent): string {
  return e.siteName?.trim() || e.title
}
function detailOf(e: PlanningEvent): string | null {
  const site = e.siteName?.trim()
  if (site && e.title?.trim() && e.title.trim() !== site) return e.title.trim()
  return null
}

function dayHeading(dateIso: string, todayIso: string): string {
  if (dateIso === todayIso) return "Aujourd'hui"
  if (dateIso === addDaysLocal(todayIso, 1)) return 'Demain'
  if (dateIso === addDaysLocal(todayIso, -1)) return 'Hier'
  return new Date(`${dateIso}T12:00:00.000Z`).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  })
}

// Bouton ÉVOLUTIF : son libellé suit le cycle de vie complet du geste —
// Préparer (avant) → Démarrer (le moment est arrivé) → Continuer (en cours)
// → Clôturer (la fin, bouton secondaire) → Consulter (tap sur la ligne Fait).
// `now` = la carte est « Maintenant » : préparer n'est plus le geste juste.
function ctaLabel(e: PlanningEvent, now = false): string {
  if (e.state === 'in_progress') {
    if (e.kind === 'visite') return 'Continuer la visite'
    if (e.kind === 'intervention') return "Continuer l'intervention"
    return 'Continuer'
  }
  if (now && e.kind === 'intervention') return "Démarrer l'intervention"
  if (now && e.kind === 'visite') return 'Démarrer la visite'
  switch (e.kind) {
    case 'visite': return 'Préparer cette visite'
    case 'reunion': return 'Préparer la réunion'
    case 'intervention': return "Préparer l'intervention"
    case 'action': return "Voir l'action"
  }
}

// « Clôturer » saute au geste de fin du flux (le bouton Terminer vit sur l'écran
// de destination) — l'intent surligne ce bouton à l'arrivée.
function cloturerHref(e: PlanningEvent): string {
  return `${e.href}${e.href.includes('?') ? '&' : '?'}intent=cloturer`
}

// « Avant de partir » : ce qu'il reste à SAVOIR sur le chantier de la prochaine
// carte. C'est le lien avec tout MemorIA — la visite cesse d'être « juste une
// visite », elle raconte. Silence positif : si rien, on n'affiche rien.
// Narration (Vincent 2026-07-10) : mise en scène du moteur, pas nouveau moteur —
// l'irréversible d'abord (fenêtre de preuve), puis la fraîcheur de la mémoire
// (dernière visite), puis l'état du chantier.
function beforeYouGo(
  e: PlanningEvent,
  all: PlanningEvent[],
  openReservesBySite: Record<string, number>,
  today: string,
  lastVisitBySite: Record<string, string> = {},
  proofLine: string | null = null,
): string[] {
  if (!e.siteId) return []
  const items: string[] = []
  // L'IRRÉVERSIBLE d'abord : le retard se rattrape, la preuve recouverte jamais.
  if (proofLine) items.push(proofLine)
  const lastVisit = lastVisitBySite[e.siteId]
  if (lastVisit) {
    const days = Math.round((new Date(`${today}T00:00:00.000Z`).getTime() - new Date(`${lastVisit.slice(0, 10)}T00:00:00.000Z`).getTime()) / 86400000)
    if (days >= 1) items.push(`dernière visite il y a ${days} j`)
  }
  const res = openReservesBySite[e.siteId] ?? 0
  if (res > 0) items.push(`${res} réserve${res > 1 ? 's' : ''} ouverte${res > 1 ? 's' : ''}`)

  const nextMtg = all.find(
    (x) => x.kind === 'reunion' && x.state === 'upcoming' && x.siteId === e.siteId && x.date >= today,
  )
  if (nextMtg) {
    const when =
      nextMtg.date === today ? "aujourd'hui"
      : nextMtg.date === addDaysLocal(today, 1) ? 'demain'
      : dayHeading(nextMtg.date, today).toLowerCase()
    items.push(`réunion ${when}`)
  }

  const acts = all.filter(
    (x) => x.kind === 'action' && x.siteId === e.siteId && (x.state === 'upcoming' || x.state === 'overdue'),
  ).length
  if (acts > 0) items.push(`${acts} action${acts > 1 ? 's' : ''} à suivre`)

  return items.slice(0, 4)
}

export default async function FieldPlanningPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const planning = await buildFieldPlanning(user.id, user.role, user.organization_id ?? null)
  const { today, events, openReservesBySite, lastVisitBySite } = planning

  // La carte « Maintenant » (l'en-cours, sinon le prochain d'aujourd'hui) : le
  // seul site pour lequel on paie une lecture de plus — la fenêtre de preuve.
  const todaysTimed = events.filter((e) => e.date === today && e.state !== 'overdue')
  const heroEvent =
    todaysTimed.find((e) => e.state === 'in_progress') ??
    todaysTimed.find((e) => e.state === 'upcoming') ??
    null
  let proofLine: string | null = null
  if (heroEvent?.siteId) {
    const pw = await detectClosingProofWindows(heroEvent.siteId).catch(() => null)
    const it = pw?.items[0]
    if (it) proofLine = `fenêtre de preuve : ${it.label} — ${(it.meta ?? '').split('·')[0].trim()}, photos avant`
  }

  const firstName = user.full_name?.trim().split(/\s+/)[0] || user.email?.split('@')[0] || ''
  const greetingDate = new Date(`${today}T12:00:00.000Z`).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  })

  // Les retards sortent de la chronologie : épinglés en tête d'aujourd'hui (ils
  // demandent une décision MAINTENANT), jamais affichés sur leur jour passé.
  const overdue = events.filter((e) => e.state === 'overdue')
  const timed = events.filter((e) => e.state !== 'overdue')

  const byDay = new Map<string, PlanningEvent[]>()
  for (const e of timed) {
    if (!byDay.has(e.date)) byDay.set(e.date, [])
    byDay.get(e.date)!.push(e)
  }
  if (!byDay.has(today)) byDay.set(today, [])
  const days = Array.from(byDay.keys()).sort()

  // Résumé de journée — « 5 événements · 1 demande votre attention ». En une
  // seconde : combien de choses, et si quelque chose bloque.
  const todayCount = (byDay.get(today) ?? []).length
  const attention = overdue.length
  const summary =
    todayCount === 0 && attention === 0
      ? 'Rien de prévu aujourd’hui.'
      : [
          todayCount > 0 ? `${todayCount} événement${todayCount > 1 ? 's' : ''}` : null,
          attention > 0 ? `${attention} demande${attention > 1 ? 'nt' : ''} votre attention` : null,
        ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-6 max-w-md pb-28">
      {/* Un vrai en-tête qui donne le ton — pas un titre perdu au-dessus d'une liste. */}
      <header className="space-y-1 pt-1">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          <NotebookText className="h-4 w-4" strokeWidth={2} />
          Journal
        </p>
        <h1 className="text-[26px] font-bold leading-tight">
          Bonjour{firstName ? ` ${firstName}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          <span className="first-letter:uppercase">{greetingDate}</span>
          {events.length > 0 && (
            <>
              {' · '}
              <span className={attention > 0 ? 'font-medium text-foreground' : ''}>{summary}</span>
            </>
          )}
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
        <div className="space-y-8">
          {days.map((date) => {
            const dayEvents = byDay.get(date) ?? []
            const isToday = date === today
            return (
              <section key={date} id={isToday ? TODAY_ANCHOR : undefined} className="scroll-mt-20">
                {/* Chaque journée = un CHAPITRE : séparation marquée + compteur. */}
                <ChapterHeading
                  label={dayHeading(date, today)}
                  count={dayEvents.length}
                  isToday={isToday}
                />

                {isToday ? (
                  <TodayRhythm
                    events={dayEvents}
                    overdue={overdue}
                    allEvents={events}
                    openReservesBySite={openReservesBySite}
                    lastVisitBySite={lastVisitBySite}
                    proofLine={proofLine}
                    today={today}
                  />
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

// En-tête de chapitre — la séparation entre journées est franche (chaque jour a
// son poids), avec le compteur d'événements. Aujourd'hui porte l'accent.
function ChapterHeading({ label, count, isToday }: { label: string; count: number; isToday: boolean }) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <h2 className={`text-base font-bold tracking-tight first-letter:uppercase ${isToday ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
        {label}
      </h2>
      {isToday && <span className="-ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
      {count > 0 && (
        <span className="text-[12px] font-medium tabular-nums text-muted-foreground">
          {count} évènement{count > 1 ? 's' : ''}
        </span>
      )}
      <span className="h-px flex-1 self-center bg-foreground/[0.08]" />
    </div>
  )
}

// ── Aujourd'hui : la journée rythmée, un compagnon — pas une frise ───────────
// Ordre de LECTURE = ordre d'IMPORTANCE : ce qui brûle (retards) → Maintenant
// (la carte vivante) → Ensuite → Fait (replié, discret, en bas).
function TodayRhythm({
  events, overdue, allEvents, openReservesBySite, lastVisitBySite, proofLine, today,
}: {
  events: PlanningEvent[]
  overdue: PlanningEvent[]
  allEvents: PlanningEvent[]
  openReservesBySite: Record<string, number>
  lastVisitBySite: Record<string, string>
  proofLine: string | null
  today: string
}) {
  const done = events.filter((e) => e.state === 'done' || e.state === 'cancelled')
  const inProgress = events.filter((e) => e.state === 'in_progress')
  const upcoming = events.filter((e) => e.state === 'upcoming')

  // « Maintenant » = l'en-cours ; à défaut, le prochain à venir. Une SEULE carte
  // vivante — celle qui appelle. Le reste raconte.
  const nowItems = inProgress.length > 0 ? inProgress : upcoming.slice(0, 1)
  const nextItems = inProgress.length > 0 ? upcoming : upcoming.slice(1)

  const empty = overdue.length === 0 && events.length === 0

  return (
    <div className="space-y-5">
      {/* Ce qui brûle — épinglé tout en haut d'aujourd'hui. */}
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
          {nowItems.length > 0 && (
            <div className="space-y-2.5">
              <RhythmSep tone="now" label="Maintenant" time={hourFromInstant(new Date().toISOString())} />
              {nowItems.map((e, idx) =>
                idx === 0 ? (
                  <HeroCard
                    key={e.id}
                    event={e}
                    context={beforeYouGo(e, allEvents, openReservesBySite, today, lastVisitBySite, proofLine)}
                  />
                ) : (
                  <EventRow key={e.id} event={e} />
                ),
              )}
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

          {/* Le fait — replié par défaut, discret : il ne pousse plus l'important vers le bas. */}
          {done.length > 0 && (
            <DoneToday count={done.length} items={done.map((e) => ({ id: e.id, title: e.title }))}>
              <ul className="space-y-1">
                {done.map((e) => (
                  <li key={e.id} data-done-id={e.id}>
                    <DoneRow event={e} />
                  </li>
                ))}
              </ul>
            </DoneToday>
          )}
        </>
      )}
    </div>
  )
}

// Séparateur de rythme — donne le tempo sans matérialiser le temps. « Maintenant »
// porte l'heure courante : l'écran vit.
function RhythmSep({ tone, label, time }: { tone: 'now' | 'next'; label: string; time?: string | null }) {
  const isNow = tone === 'now'
  const color = isNow ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
  const rule = isNow ? 'bg-emerald-500/25' : 'bg-foreground/[0.06]'
  return (
    <div className="flex items-center gap-2">
      {isNow && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />}
      <span className={`text-[11px] font-bold uppercase tracking-[0.08em] ${color}`}>{label}</span>
      {isNow && time && (
        <span className="text-[11px] font-semibold tabular-nums text-emerald-600/80 dark:text-emerald-400/80">· {time}</span>
      )}
      <span className={`h-px flex-1 rounded ${rule}`} />
    </div>
  )
}

// La carte du MOMENT : la seule qui « appelle ». Chantier vedette + heure forte,
// « Avant de partir » (le lien MemorIA), bouton évolutif aux couleurs du type.
function HeroCard({ event, context }: { event: PlanningEvent; context: string[] }) {
  const theme = KIND_THEME[event.kind]
  const time = displayTime(event)
  const detail = detailOf(event)
  return (
    <div className={`rounded-2xl border ${theme.accentBorder} bg-card p-4 shadow-sm ring-2 ${theme.accentRing}`}>
      <Link href={event.href} className="flex items-start gap-3.5">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${theme.heroChip}`}>
          <theme.Icon className="h-[22px] w-[22px]" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[16px] font-bold leading-snug">{headlineOf(event)}</span>
            {time && <span className="shrink-0 text-[15px] font-bold tabular-nums text-foreground/80">{time}</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[13px]">
            <span className="font-semibold uppercase tracking-wide text-muted-foreground/80">{theme.label}</span>
            {detail && <span className="min-w-0 truncate text-muted-foreground">· {detail}</span>}
          </span>
        </span>
      </Link>

      {context.length > 0 && (
        <div className="mt-3.5 rounded-xl bg-muted/40 px-3.5 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Avant de partir</p>
          <ul className="mt-1.5 space-y-1">
            {context.map((c) => (
              <li key={c} className="flex items-center gap-2 text-[13px] text-foreground/80">
                <span className="h-1 w-1 shrink-0 rounded-full bg-foreground/40" aria-hidden />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {event.state === 'in_progress' ? (
        /* En cours : deux issues, zéro ambiguïté — Continuer ramène dans le flux,
           Clôturer saute au geste de fin (le bouton Terminer y est surligné). */
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <Link
            href={event.href}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors ${theme.accentBtn}`}
          >
            Continuer
          </Link>
          <Link
            href={cloturerHref(event)}
            className="flex items-center justify-center gap-2 rounded-xl border border-foreground/15 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors active:bg-muted/40"
          >
            Clôturer
            <Check className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        </div>
      ) : (
        <Link
          href={event.href}
          className={`mt-3.5 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors ${theme.accentBtn}`}
        >
          {ctaLabel(event, true)}
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  )
}

// Retard épinglé — hors chronologie : il demande une décision aujourd'hui. Rouge
// MEDU réservé aux vraies vigilances (doctrine-design-ux).
function OverdueRow({ event, today }: { event: PlanningEvent; today: string }) {
  const sub = [KIND_THEME[event.kind].label, event.siteName].filter(Boolean).join(' · ')
  const due = dayHeading(event.date, today).toLowerCase()
  return (
    <Link
      href={event.href}
      className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50/70 px-3.5 py-3 dark:border-red-900/40 dark:bg-red-950/20"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
        <AlertTriangle className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold leading-snug">{event.title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {sub} · échéance {due}
        </span>
      </span>
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">En retard</span>
    </Link>
  )
}

// Ligne d'événement — heure forte à gauche (le temps est le personnage), pastille
// de type colorée (l'identité), chantier vedette. L'état « à venir » ne crie pas :
// pas de badge, juste le chevron (silence positif).
function EventRow({ event, muted = false }: { event: PlanningEvent; muted?: boolean }) {
  const theme = KIND_THEME[event.kind]
  const time = displayTime(event)
  const detail = detailOf(event)
  return (
    <Link
      href={event.href}
      className={`flex items-center gap-3 rounded-2xl border border-foreground/[0.07] bg-card py-3 pl-2.5 pr-3 shadow-sm transition-colors active:bg-muted/40 ${muted ? 'opacity-70' : ''}`}
    >
      {/* Colonne HEURE — personnage principal. « De la journée » quand pas d'heure. */}
      <span className="flex w-12 shrink-0 flex-col items-center">
        {time ? (
          <span className="text-[15px] font-bold leading-none tabular-nums">{time}</span>
        ) : (
          <span className="text-[10px] font-medium uppercase leading-none text-muted-foreground/60">journée</span>
        )}
      </span>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${theme.chip}`}>
        <theme.Icon className="h-[19px] w-[19px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-snug">{headlineOf(event)}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[12px]">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground/80">{theme.label}</span>
          {detail && <span className="min-w-0 truncate text-muted-foreground">· {detail}</span>}
        </span>
      </span>
      <StateTag state={event.state} />
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" />
    </Link>
  )
}

// L'état, juste quand il DIT quelque chose. « À venir » n'affiche rien.
function StateTag({ state }: { state: PlanningEventState }) {
  if (state === 'in_progress') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
        En cours
      </span>
    )
  }
  if (state === 'done') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" title="Fait">
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    )
  }
  if (state === 'cancelled') {
    return <span className="shrink-0 text-[11px] font-medium text-muted-foreground line-through">Annulé</span>
  }
  return null
}

// Ligne « fait » COMPACTE — le terminé est la chose la moins importante : petit,
// atténué, sans chevron. On barre d'un trait mental, on n'y revient pas.
function DoneRow({ event }: { event: PlanningEvent }) {
  const theme = KIND_THEME[event.kind]
  const time = displayTime(event)
  return (
    <Link
      href={event.href}
      className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 opacity-70 transition-opacity active:opacity-100"
    >
      <span className="w-10 shrink-0 text-right text-[12px] font-semibold tabular-nums text-muted-foreground">
        {time ?? ''}
      </span>
      <theme.Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{headlineOf(event)}</span>
      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600/70 dark:text-emerald-400/70" strokeWidth={2.5} />
    </Link>
  )
}
