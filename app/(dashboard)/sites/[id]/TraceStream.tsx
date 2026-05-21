import Link from 'next/link'
import { AlertTriangle, FileText, Camera, Info, KeyRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SiteMemoryEvent } from '@/lib/db/site-memory'
import type { SiteMemoryMeta } from '@/lib/db/site-cockpit'
import { salienceOf } from '@/lib/perception/salience'
import { opacityOf, ageDaysSince } from '@/lib/perception/fading'
import {
  gapHeightPx,
  silenceLabel,
  shouldRenderSilenceMarker,
} from '@/lib/perception/gaps'

import { localDateOf, todayLocalIso, addDaysLocal } from '@/lib/time/local-date'

function formatMonthYear(iso: string): string {
  const d = new Date(iso)
  const m = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Pacific/Noumea' })
  return m.charAt(0).toUpperCase() + m.slice(1)
}

const FR_MONTHS_SHORT = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

// Comparaison en dates CIVILES (zone Nouméa), pas en epoch ms. Évite le bug
// où "il y a 38h" est floor à 1 jour et affiché "hier" alors que c'est 2j.
function formatShortDate(iso: string): string {
  const d = new Date(iso)
  const taskIso = localDateOf(d)
  const today = todayLocalIso()
  const yesterday = addDaysLocal(today, -1)
  if (taskIso === today) return "aujourd'hui"
  if (taskIso === yesterday) return 'hier'
  const [y, m, dd] = taskIso.split('-').map(Number)
  const todayYear = Number(today.slice(0, 4))
  const yearSuffix = y !== todayYear ? ` ${y}` : ''
  return `${dd} ${FR_MONTHS_SHORT[m - 1]}${yearSuffix}`
}

/**
 * V5.1.4 — Mémoire du lieu / TraceStream, style cohérent shadcn.
 *
 * Garde la sémantique stratifiée (opacity fading, gaps proportionnels au
 * silence, cicatrice persistante pour anomalies) — c'est doctrinal, pas
 * stylistique. Mais visuellement aligné avec le reste de l'app (text-sm,
 * text-muted-foreground, icônes Lucide, palette sémantique).
 */

const TYPE_ICON: Record<SiteMemoryEvent['type'], LucideIcon> = {
  intervention: FileText,
  photo: Camera,
  anomaly: AlertTriangle,
  note: Info,
  a_savoir: Info,
  access: KeyRound,
}

const TYPE_ICON_COLOR: Record<SiteMemoryEvent['type'], string> = {
  intervention: 'text-muted-foreground',
  photo: 'text-sky-600',
  anomaly: 'text-amber-600',
  note: 'text-muted-foreground',
  a_savoir: 'text-muted-foreground',
  // Incident d'accès → amber (saillant) ; routine → neutre. Géré via meta.
  access: 'text-muted-foreground',
}

// Vincent 2026-05-21 — badge texte explicite pour que l'utilisateur sache
// IMMÉDIATEMENT de quoi est faite chaque ligne (anomalie ? note ? passage ?
// résonance ?). C'est SAISI PAR DES HUMAINS, pas généré par l'IA.
const TYPE_BADGE_LABEL: Record<SiteMemoryEvent['type'], string> = {
  intervention: 'Note d’intervention',
  photo: 'Photo',
  anomaly: 'Signalement',
  note: 'Note de site',
  a_savoir: 'À savoir',
  access: 'Accès',
}

const TYPE_BADGE_CLASS: Record<SiteMemoryEvent['type'], string> = {
  intervention: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  photo: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/30 dark:text-sky-200 dark:border-sky-800',
  anomaly: 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800',
  note: 'bg-stone-50 text-stone-700 border-stone-200 dark:bg-stone-900 dark:text-stone-200 dark:border-stone-700',
  a_savoir: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-200 dark:border-indigo-800',
  access: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800',
}

function badgeLabelFor(event: SiteMemoryEvent): string {
  // Cas spéciaux selon meta
  if (event.type === 'anomaly' && event.meta?.grouped === true) {
    return 'Signalements groupés'
  }
  if (event.type === 'access' && event.meta?.kind === 'incident') {
    return 'Incident d’accès'
  }
  return TYPE_BADGE_LABEL[event.type]
}

interface Props {
  events: SiteMemoryEvent[]
  meta?: SiteMemoryMeta
}

export function TraceStream({ events, meta }: Props) {
  if (events.length === 0) {
    if (meta && (meta.executedInterventions > 0 || meta.photoCount > 0)) {
      const parts: string[] = []
      if (meta.executedInterventions > 0)
        parts.push(`${meta.executedInterventions} passage${meta.executedInterventions > 1 ? 's' : ''}`)
      if (meta.tasksCompleted > 0)
        parts.push(`${meta.tasksCompleted} tâche${meta.tasksCompleted > 1 ? 's' : ''} réalisée${meta.tasksCompleted > 1 ? 's' : ''}`)
      if (meta.photoCount > 0)
        parts.push(`${meta.photoCount} photo${meta.photoCount > 1 ? 's' : ''}`)
      const since = meta.firstTraceAt ? ` depuis ${formatMonthYear(meta.firstTraceAt).toLowerCase()}` : ''
      const lastTask = meta.lastTaskCompletedAt ? ` — dernière tâche le ${formatShortDate(meta.lastTaskCompletedAt)}` : ''
      return (
        <p className="text-sm text-muted-foreground">
          {parts.join(' · ')}{since}{lastTask}.
        </p>
      )
    }
    return (
      <p className="text-sm text-muted-foreground italic">
        Le lieu commence à se documenter.
      </p>
    )
  }

  const now = new Date()

  // Summary header
  const summaryParts: string[] = []
  if (meta) {
    if (meta.executedInterventions > 0)
      summaryParts.push(`${meta.executedInterventions} passage${meta.executedInterventions > 1 ? 's' : ''}`)
    if (meta.tasksCompleted > 0)
      summaryParts.push(`${meta.tasksCompleted} tâche${meta.tasksCompleted > 1 ? 's' : ''} réalisée${meta.tasksCompleted > 1 ? 's' : ''}`)
    if (meta.photoCount > 0)
      summaryParts.push(`${meta.photoCount} photo${meta.photoCount > 1 ? 's' : ''}`)
  }

  // Vincent 2026-05-21 — types présents dans le flux, pour la légende compacte.
  const typesPresent = new Set<SiteMemoryEvent['type']>(events.map((e) => e.type))
  const LEGEND_ORDER: SiteMemoryEvent['type'][] = ['intervention', 'anomaly', 'note', 'a_savoir', 'photo', 'access']

  return (
    <div className="space-y-3">
      {summaryParts.length > 0 && (
        <p className="text-xs text-muted-foreground">{summaryParts.join(' · ')}</p>
      )}

      {/* Légende des badges — explique l'origine de chaque ligne.
          Vincent 2026-05-21 : on ne sait pas si c'est une anomalie / note /
          passage / résonance. La légende lève toute ambiguïté. */}
      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wide">Légende :</span>
        {LEGEND_ORDER.filter((t) => typesPresent.has(t)).map((t) => (
          <span
            key={t}
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium uppercase tracking-wide ${TYPE_BADGE_CLASS[t]}`}
          >
            {TYPE_BADGE_LABEL[t]}
          </span>
        ))}
      </div>
      {/* Liste des tâches avec leur dernière date */}
      {meta && meta.taskHistory.length > 0 && (
        <ul className="space-y-0.5">
          {meta.taskHistory.map((t) => (
            <li key={t.label} className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="h-1 w-1 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                <span className="truncate">{t.label}</span>
              </span>
              <span className="tabular-nums shrink-0 text-[10px]">
                {t.count > 1 && <span className="mr-1.5 text-muted-foreground/60">×{t.count}</span>}
                {formatShortDate(t.lastDoneAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ol className="space-y-0">
        {events.map((event, idx) => {
        const ageDays = ageDaysSince(event.occurredAt, now)
        const salience = salienceOf(event)
        const opacity = opacityOf(salience, ageDays)

        const prev = events[idx - 1]
        const daysBetween = prev
          ? Math.max(
              0,
              Math.floor(
                (new Date(prev.occurredAt).getTime() -
                  new Date(event.occurredAt).getTime()) /
                  86_400_000,
              ),
            )
          : 0
        const gapPx = idx === 0 ? 0 : Math.min(gapHeightPx(daysBetween), 80)
        const showSilence = idx > 0 && shouldRenderSilenceMarker(daysBetween)
        const silenceText = showSilence ? silenceLabel(daysBetween) : null

        return (
          <li key={`${event.type}-${event.id}`}>
            {idx > 0 && (
              <div
                aria-hidden
                style={{ height: gapPx }}
                className="relative flex items-center justify-center"
              >
                {silenceText && (
                  <span className="text-xs italic text-muted-foreground/60 select-none">
                    {silenceText}
                  </span>
                )}
              </div>
            )}
            <TraceLine event={event} opacity={opacity} ageDays={ageDays} />
          </li>
        )
      })}
    </ol>
    </div>
  )
}

interface TraceLineProps {
  event: SiteMemoryEvent
  opacity: number
  ageDays: number
}

function TraceLine({ event, opacity, ageDays }: TraceLineProps) {
  // Bordure gauche cicatrice anomalie — doctrinal, persistante même après
  // résolution. Conservée mais en palette sémantique amber/muted.
  let borderClass = ''
  if (event.type === 'anomaly') {
    const status = event.status ?? 'open'
    if (status === 'open') {
      borderClass = ageDays < 14 ? 'border-l-2 border-amber-500' : 'border-l-2 border-amber-300'
    } else if (status === 'resolved') {
      borderClass = ageDays < 90 ? 'border-l-2 border-muted-foreground/40' : 'border-l border-muted-foreground/20'
    } else {
      borderClass = 'border-l border-muted-foreground/10'
    }
  }

  const dateLabel = formatDateLabel(event.occurredAt, ageDays)
  const Icon = TYPE_ICON[event.type]
  const iconColor = TYPE_ICON_COLOR[event.type]

  const inner = (
    <div
      className={`flex items-start gap-2.5 py-2 px-2 ${borderClass}`}
      style={{ opacity, paddingLeft: borderClass ? 12 : 8 }}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${iconColor}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-2 flex-wrap min-w-0">
            <span
              className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TYPE_BADGE_CLASS[event.type]}`}
              title={`Source : ${badgeLabelFor(event).toLowerCase()}`}
            >
              {badgeLabelFor(event)}
            </span>
            <span className="text-sm leading-snug">{event.title}</span>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {dateLabel}
          </span>
        </div>
        {event.detail && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {event.detail}
          </p>
        )}
      </div>
    </div>
  )

  const href = event.interventionId ? `/interventions/${event.interventionId}` : null
  if (href) {
    return (
      <Link href={href} className="block hover:bg-muted/30 rounded transition-colors">
        {inner}
      </Link>
    )
  }
  return inner
}

function formatDateLabel(iso: string, ageDays: number): string {
  const d = new Date(iso)
  if (ageDays === 0) return "aujourd'hui"
  if (ageDays === 1) return 'hier'
  if (ageDays < 7) {
    return d.toLocaleDateString('fr-FR', { weekday: 'long' })
  }
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}
