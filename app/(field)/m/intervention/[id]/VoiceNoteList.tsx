'use client'

import { Mic, Play, Pause } from 'lucide-react'
import { useRef, useState } from 'react'
import type { VoiceNoteRow } from '@/lib/db/intervention-voice-notes'

interface Props {
  notes: Array<VoiceNoteRow & { signedUrl: string | null }>
}

function fmtDuration(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function NotePlayer({ note }: { note: Props['notes'][0] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      setPlaying(false)
    } else {
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }

  const text = note.fragment_validated || note.transcription_corrected || note.transcription_raw || null

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
      <button
        type="button"
        onClick={toggle}
        disabled={!note.signedUrl}
        className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-foreground text-background disabled:opacity-40 active:bg-foreground/80"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      <div className="flex-1 min-w-0">
        {text ? (
          <p className="text-sm leading-snug">{text}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">Note enregistrée</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">{fmtDuration(note.duration_seconds)}</p>
      </div>

      {note.signedUrl && (
        <audio
          ref={audioRef}
          src={note.signedUrl}
          onEnded={() => setPlaying(false)}
          preload="none"
        />
      )}
    </div>
  )
}

export function VoiceNoteList({ notes }: Props) {
  if (notes.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium flex items-center gap-1.5 text-muted-foreground">
        <Mic className="h-4 w-4" />
        Notes vocales ({notes.length})
      </h2>
      <div className="space-y-2">
        {notes.map((n) => <NotePlayer key={n.id} note={n} />)}
      </div>
    </section>
  )
}
