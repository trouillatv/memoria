'use client'

import { Mic, Play, Pause, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { VoiceNoteRow } from '@/lib/db/intervention-voice-notes'
import { ignoreVoiceNoteAction } from './voice-note-actions'

interface Props {
  notes: Array<VoiceNoteRow & { signedUrl: string | null }>
}

function fmtDuration(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function NotePlayer({ note }: { note: Props['notes'][0] }) {
  const router = useRouter()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

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

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    await ignoreVoiceNoteAction(note.id)
    router.refresh()
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

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className={`shrink-0 flex items-center justify-center h-8 rounded-lg px-2 text-xs gap-1 transition-colors ${
          confirming
            ? 'bg-destructive text-destructive-foreground'
            : 'text-muted-foreground hover:text-destructive'
        }`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {confirming && <span>Confirmer</span>}
      </button>

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
