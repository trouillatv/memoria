'use client'

import { Mic } from 'lucide-react'

/**
 * Lecteur audio sobre pour une voice note de tender.
 * Player HTML5 natif. Affiche la durée et la date d'enregistrement.
 *
 * Doctrine V5 — archive personnelle. Wording strictement neutre.
 */

interface VoiceNotePlayerProps {
  signedUrl: string
  durationSeconds: number | null
  recordedAt: string | null
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}min`
  return `${m}min${s.toString().padStart(2, '0')}`
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return null
  }
}

export function VoiceNotePlayer({
  signedUrl,
  durationSeconds,
  recordedAt,
}: VoiceNotePlayerProps) {
  const durationLabel = formatDuration(durationSeconds)
  const dateLabel = formatDate(recordedAt)

  return (
    <div className="space-y-2" data-slot="voice-note-player">
      <audio
        controls
        src={signedUrl}
        preload="metadata"
        className="w-full"
        data-slot="voice-note-audio"
      />
      {(durationLabel || dateLabel) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mic className="h-3 w-3" aria-hidden="true" />
          {durationLabel && <span>{durationLabel}</span>}
          {durationLabel && dateLabel && <span aria-hidden="true">·</span>}
          {dateLabel && <span>{dateLabel}</span>}
        </div>
      )}
    </div>
  )
}
