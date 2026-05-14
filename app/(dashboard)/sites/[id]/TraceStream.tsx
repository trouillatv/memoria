import Link from 'next/link'
import { AlertTriangle, FileText, Camera, Info } from 'lucide-react'
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

function formatMonthYear(iso: string): string {
  const d = new Date(iso)
  const m = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return m.charAt(0).toUpperCase() + m.slice(1)
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
}

const TYPE_ICON_COLOR: Record<SiteMemoryEvent['type'], string> = {
  intervention: 'text-muted-foreground',
  photo: 'text-sky-600',
  anomaly: 'text-amber-600',
  note: 'text-muted-foreground',
  a_savoir: 'text-muted-foreground',
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
      return (
        <p className="text-sm text-muted-foreground">
          {parts.join(' · ')}{since}.
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

  // Summary header when we have enriched meta
  const summaryParts: string[] = []
  if (meta) {
    if (meta.executedInterventions > 0)
      summaryParts.push(`${meta.executedInterventions} passage${meta.executedInterventions > 1 ? 's' : ''}`)
    if (meta.tasksCompleted > 0)
      summaryParts.push(`${meta.tasksCompleted} tâche${meta.tasksCompleted > 1 ? 's' : ''} réalisée${meta.tasksCompleted > 1 ? 's' : ''}`)
    if (meta.photoCount > 0)
      summaryParts.push(`${meta.photoCount} photo${meta.photoCount > 1 ? 's' : ''}`)
  }

  return (
    <div className="space-y-3">
      {summaryParts.length > 0 && (
        <p className="text-xs text-muted-foreground">{summaryParts.join(' · ')}</p>
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
          <span className="text-sm leading-snug">{event.title}</span>
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
