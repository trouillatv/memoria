'use client'

import { useRef, useState } from 'react'
import { Mic, Play, Pause } from 'lucide-react'

export interface VoiceNoteDisplay {
  id: string
  signedUrl: string | null
  duration_seconds: number
  transcription_corrected: string
  fragment_validated: string | null
  author_name: string | null
  recorded_at: string
  validated_at: string
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Pacific/Noumea',
  })
}

function fmtClock(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

/**
 * Lecteur audio compact. La durée totale vient TOUJOURS de la base
 * (`durationSeconds`), jamais de l'élément <audio> : les notes vocales sont
 * enregistrées en WebM via MediaRecorder, conteneur qui n'écrit pas la durée
 * dans son en-tête → l'élément natif renvoie Infinity tant que le fichier
 * n'a pas été lu en entier. On garde l'audio brut, on pilote l'UI nous-mêmes.
 */
function NoteAudioPlayer({ src, durationSeconds }: { src: string; durationSeconds: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const total = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (playing) el.pause()
    else el.play().catch(() => setPlaying(false))
  }

  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const el = audioRef.current
    if (!el || total <= 0) return
    const t = Number(e.target.value)
    el.currentTime = t
    setCurrentTime(t)
  }

  const clamped = total > 0 ? Math.min(currentTime, total) : currentTime

  return (
    <div className="flex items-center gap-3" data-slot="voice-note-player">
      <button
        type="button"
        onClick={toggle}
        className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-foreground text-background hover:bg-foreground/90 transition-colors"
        aria-label={playing ? 'Pause' : 'Lecture'}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
      </button>
      <input
        type="range"
        min={0}
        max={total > 0 ? total : 1}
        step={0.1}
        value={clamped}
        onChange={onSeek}
        disabled={total <= 0}
        className="flex-1 h-1 accent-foreground cursor-pointer disabled:cursor-default"
        aria-label="Position de lecture"
      />
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground w-[68px] text-right">
        {fmtClock(clamped)} / {fmtClock(total)}
      </span>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0) }}
        onTimeUpdate={() => {
          const el = audioRef.current
          if (el) setCurrentTime(el.currentTime)
        }}
      />
    </div>
  )
}

export function VoiceNotesSection({ notes }: { notes: VoiceNoteDisplay[] }) {
  if (notes.length === 0) return null

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center gap-2 px-4 py-3 border-b">
        <Mic className="h-4 w-4 text-muted-foreground shrink-0" />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Notes terrain
        </h2>
        <span className="ml-auto text-xs text-muted-foreground">{notes.length}</span>
      </header>

      <ul className="divide-y divide-border">
        {notes.map((note) => (
          <li key={note.id} className="p-4 space-y-3">

            {/* Métadonnées */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-foreground">
                {note.author_name ?? 'Agent terrain'}
              </span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{formatDuration(note.duration_seconds)}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(note.recorded_at)}</span>
              <span className="ml-auto inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                validée
              </span>
            </div>

            {/* Fragment mémoire validé — prioritaire sur la transcription */}
            {note.fragment_validated && (
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
                {note.fragment_validated}
              </div>
            )}

            {/* Transcription corrigée — interprétation complète, toujours accessible */}
            <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground leading-relaxed">
              {note.transcription_corrected}
            </blockquote>

            {/* Lecteur audio — artefact brut */}
            {note.signedUrl && (
              <div className="pt-1">
                <NoteAudioPlayer src={note.signedUrl} durationSeconds={note.duration_seconds} />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Enregistrement original — artefact brut conservé
                </p>
              </div>
            )}

          </li>
        ))}
      </ul>
    </section>
  )
}
