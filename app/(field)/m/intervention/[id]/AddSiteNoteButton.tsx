'use client'

// Sprint 2 — Mémoire des lieux : bouton + form inline pour ajouter une note
// courte sur le site, depuis la page intervention mobile (Joseph).
//
// Doctrine V5 :
//   - Pilier 5 (agent oubliable) : 2 taps total.
//     Tap 1 : ouvrir le form. Tap 2 : Ajouter.
//   - Verrou V4 (pas de contrôle humain) : placeholder factuel passif.
//   - Verrou V5 (édition contrainte) : maxLength 140, pas de rich text.
//
// Wording autorisé :
//   - Placeholder : « Ex : Bloc B : humidité signalée »
//   - Bouton trigger : « Ajouter une note sur ce site »
//   - Bouton submit : « Ajouter »
//
// Wording refusé (verrou V4) :
//   - « Pense à... », « Attention à... », « N'oublie pas... »
//   - « Tu dois... », « Merci de... », « Fais attention »

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { addSiteNoteAction } from './site-note-actions'
import { showTimeSavedToast } from '@/components/ui/time-saved-toast'

interface Props {
  siteId: string
  /** Override pour les tests — injection du server action. */
  action?: (input: { siteId: string; body: string }) => Promise<
    { ok: true } | { ok: false; error: string }
  >
}

export function AddSiteNoteButton({ siteId, action }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [createdNotes, setCreatedNotes] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const trimmed = body.trim()
  const canSubmit = trimmed.length >= 3 && trimmed.length <= 140 && !pending

  function handleSubmit() {
    if (!canSubmit) return
    setError(null)
    startTransition(async () => {
      const fn = action ?? addSiteNoteAction
      const result = await fn({ siteId, body: trimmed })
      if (result.ok) {
        setCreatedNotes((prev) => [trimmed, ...prev])
        setOpen(false)
        setBody('')
        // Sprint 5 UX-9 — Temps retrouvé : confirmation discrète et factuelle.
        showTimeSavedToast('Note ajoutée à ce site')
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  function handleCancel() {
    setOpen(false)
    setBody('')
    setError(null)
  }

  if (!open) {
    return (
      <div className="space-y-2">
        {createdNotes.length > 0 && (
          <ul className="space-y-1.5" aria-label="Notes ajoutées sur ce site">
            {createdNotes.map((note, index) => (
              <li key={`${note}-${index}`} className="text-sm leading-relaxed">
                • {note}
                <span className="text-[10px] text-muted-foreground/60 ml-2">
                  (à l&apos;instant)
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          data-testid="add-site-note-trigger"
          onClick={() => setOpen(true)}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1 rounded border border-dashed hover:bg-muted/30 transition-colors mt-2"
        >
          <Plus className="h-3 w-3" />
          Ajouter une note sur ce site
        </button>
      </div>
    )
  }

  return (
    <div
      className="mt-2 rounded-lg border bg-card p-3 space-y-2"
      data-testid="add-site-note-form"
    >
      <label
        htmlFor="add-site-note-body"
        className="text-xs text-muted-foreground"
      >
        Note courte sur ce site (140 caractères max)
      </label>
      <textarea
        id="add-site-note-body"
        data-testid="add-site-note-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={140}
        rows={2}
        placeholder="Ex : Bloc B : humidité signalée"
        className="w-full text-sm p-2 border rounded resize-none focus:outline-none focus:ring-1 focus:ring-foreground/20"
        autoFocus
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {body.length} / 140
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="add-site-note-cancel"
            onClick={handleCancel}
            className="text-xs px-3 py-1.5 rounded border text-muted-foreground hover:text-foreground"
          >
            Annuler
          </button>
          <button
            type="button"
            data-testid="add-site-note-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="text-xs px-3 py-1.5 rounded bg-foreground text-background hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? 'Ajout…' : 'Ajouter'}
          </button>
        </div>
      </div>
      {error && (
        <div
          data-testid="add-site-note-error"
          className="text-xs text-red-700"
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  )
}
