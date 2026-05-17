'use client'

import { Mic } from 'lucide-react'

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
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  controls
                  src={note.signedUrl}
                  className="w-full h-9"
                  preload="metadata"
                />
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
