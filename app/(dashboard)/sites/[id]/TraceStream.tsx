import Link from 'next/link'
import type { SiteMemoryEvent } from '@/lib/db/site-memory'
import { salienceOf } from '@/lib/perception/salience'
import { opacityOf, ageDaysSince } from '@/lib/perception/fading'
import {
  gapHeightPx,
  silenceLabel,
  shouldRenderSilenceMarker,
} from '@/lib/perception/gaps'

/**
 * V5.1 Slice 3 — Flux stratifié de traces.
 *
 * Substrat sédimentaire, pas timeline. Chaque event a une opacity calculée
 * côté serveur (salience × age decay). Les gaps verticaux sont
 * proportionnels au temps écoulé entre events (limite 220px), avec
 * micro-repère textuel qualitatif au-delà de 14j de silence.
 *
 * Cicatrices :
 *   - Anomalie active : bordure-gauche 2px noire pleine
 *   - Anomalie en cours (status=open mais ancienne) : idem, mais opacity baissée
 *   - Anomalie résolue : bordure-gauche 1.5px grise persistante
 *   - Anomalie ignorée : bordure-gauche 1px gris clair quasi-transparente
 *
 * Aucun titre de section temporelle ("Mai", "Avril"). Aucun chiffre saillant.
 * Aucune couleur sémantique. Le passage du temps est un matériau visuel.
 */

interface Props {
  events: SiteMemoryEvent[]
}

export function TraceStream({ events }: Props) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center border rounded-lg">
        Pas encore d&apos;événement enregistré sur ce lieu.
      </p>
    )
  }

  const now = new Date()

  return (
    <ol className="relative">
      {events.map((event, idx) => {
        const ageDays = ageDaysSince(event.occurredAt, now)
        const salience = salienceOf(event)
        const opacity = opacityOf(salience, ageDays)

        // Calcul du gap avec l'event précédent (events triés DESC, donc
        // "précédent dans l'array" = plus récent dans le temps).
        const prev = events[idx - 1]
        const daysBetween = prev
          ? Math.max(
              0,
              Math.floor(
                (new Date(prev.occurredAt).getTime() -
                  new Date(event.occurredAt).getTime()) /
                  86_400_000
              )
            )
          : 0
        const gapPx = idx === 0 ? 0 : gapHeightPx(daysBetween)
        const showSilence = idx > 0 && shouldRenderSilenceMarker(daysBetween)
        const silenceText = showSilence ? silenceLabel(daysBetween) : null

        return (
          <li key={`${event.type}-${event.id}`} className="relative">
            {idx > 0 && (
              <div
                aria-hidden
                style={{ height: gapPx }}
                className="relative flex items-center justify-center"
              >
                {silenceText && (
                  <span className="text-[12px] italic text-muted-foreground/70 select-none">
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
  )
}

interface TraceLineProps {
  event: SiteMemoryEvent
  opacity: number
  ageDays: number
}

function TraceLine({ event, opacity, ageDays }: TraceLineProps) {
  // Bordure gauche pour les anomalies — cicatrice persistante.
  // Couleur dégradée selon le statut + l'âge.
  let borderLeft: string | undefined
  let borderColor: string | undefined
  if (event.type === 'anomaly') {
    const status = event.status ?? 'open'
    if (status === 'open') {
      borderLeft = '2px solid'
      borderColor = ageDays < 14 ? '#0a0a0a' : '#555555'
    } else if (status === 'resolved') {
      borderLeft = ageDays < 90 ? '1.5px solid' : '1px solid'
      borderColor = ageDays < 90 ? '#888888' : '#c0c0c0'
    } else {
      borderLeft = '1px solid'
      borderColor = '#e8e8e8'
    }
  }

  // Format date sobre — pas de "il y a X jours" qui interpréterait l'âge.
  // Juste la date factuelle. Pour les events ≤ 1 semaine, garder un repère
  // contextuel sec ("aujourd'hui", "hier", jour de la semaine).
  const dateLabel = formatDateLabel(event.occurredAt, ageDays)

  const inner = (
    <div
      className="py-2 px-3 transition-opacity"
      style={{
        opacity,
        borderLeft,
        borderLeftColor: borderColor,
        paddingLeft: borderLeft ? 12 : undefined,
      }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-[15px] leading-tight">{event.title}</span>
        <span className="text-[12px] text-muted-foreground tabular-nums shrink-0">
          {dateLabel}
        </span>
      </div>
      {event.detail && (
        <p className="text-[13px] text-muted-foreground mt-1 line-clamp-2">
          {event.detail}
        </p>
      )}
    </div>
  )

  const href = event.interventionId ? `/interventions/${event.interventionId}` : null
  if (href) {
    return (
      <Link href={href} className="block hover:bg-muted/30 rounded-sm">
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
