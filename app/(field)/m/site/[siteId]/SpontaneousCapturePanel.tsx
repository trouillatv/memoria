'use client'

import { useRef, useState, useTransition } from 'react'
import { Camera, AlertTriangle, Check, StickyNote, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { queuePhoto } from '@/lib/field/photo-queue'
import { addSiteNoteAction } from './note-actions'

/**
 * Capture spontanée sur un site (mobile). Un seul point d'entrée NOIR :
 * « Prendre une note ou une photo ». Le terrain capture sans friction ; le
 * rangement (sous-périmètre) se fait plus tard côté bureau (IA propose / valide).
 *
 *   Photo → caméra → « Passage » / « Anomalie » → queuePhoto (sync silencieuse)
 *   Note  → texte court (140 car.) → site_notes (mémoire du lieu, recherchable)
 */

type CapturedPhoto = { blob: Blob; previewUrl: string } | null
type Mode = 'idle' | 'choice' | 'note'

export function SpontaneousCapturePanel({ siteId }: { siteId: string }) {
  const [mode, setMode] = useState<Mode>('idle')
  const [photo, setPhoto] = useState<CapturedPhoto>(null)
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function openCamera() {
    inputRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhoto({ blob: file, previewUrl: URL.createObjectURL(file) })
    setMode('idle')
  }

  function cancelPhoto() {
    if (photo) URL.revokeObjectURL(photo.previewUrl)
    setPhoto(null)
  }

  function deposit(intent: 'passage' | 'anomaly') {
    if (!photo) return
    startTransition(async () => {
      try {
        await queuePhoto({
          blob: photo.blob,
          filename: `${intent}-${Date.now()}.jpg`,
          mimeType: photo.blob.type || 'image/jpeg',
          checklistItemId: null,
          siteId,
          intent,
          kind: intent === 'anomaly' ? 'anomaly' : 'passage',
        })
        URL.revokeObjectURL(photo.previewUrl)
        setPhoto(null)
        toast.success('Trace déposée', { duration: 1500 })
      } catch (err) {
        console.error('[queueSpontaneousPhoto]', err)
        toast.error('Erreur lors de la sauvegarde')
      }
    })
  }

  function saveNote() {
    const body = note.trim()
    if (body.length < 3) return
    startTransition(async () => {
      const r = await addSiteNoteAction({ siteId, body })
      if (r.ok) {
        setNote('')
        setMode('idle')
        toast.success('Note déposée', { duration: 1500 })
      } else {
        toast.error(r.error)
      }
    })
  }

  // ── Overlay 1 : photo prise → Passage / Anomalie ───────────────────────────
  if (photo) {
    return (
      <div className="fixed inset-x-0 bottom-0 p-4 bg-background border-t safe-bottom space-y-3">
        <div className="rounded-lg overflow-hidden border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.previewUrl} alt="Aperçu" className="w-full max-h-40 object-cover" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => deposit('passage')}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-foreground text-background font-medium text-sm py-2.5 active:scale-[0.99] transition-transform disabled:opacity-60"
          >
            <Check className="h-4 w-4" />
            Passage
          </button>
          <button
            type="button"
            onClick={() => deposit('anomaly')}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium text-sm py-2.5 active:scale-[0.99] transition-transform disabled:opacity-60"
            style={{ borderColor: '#8a3030', color: '#8a3030' }}
          >
            <AlertTriangle className="h-4 w-4" />
            Anomalie
          </button>
        </div>
        <button type="button" onClick={cancelPhoto} disabled={pending} className="w-full text-sm text-muted-foreground py-2">
          Reprendre la photo
        </button>
      </div>
    )
  }

  // ── Overlay 2 : composer une note ──────────────────────────────────────────
  if (mode === 'note') {
    return (
      <div className="fixed inset-x-0 bottom-0 p-4 bg-background border-t safe-bottom space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium inline-flex items-center gap-1.5">
            <StickyNote className="h-4 w-4" /> Note sur ce chantier
          </span>
          <button type="button" onClick={() => { setMode('idle'); setNote('') }} disabled={pending} aria-label="Fermer" className="text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={140}
          rows={3}
          autoFocus
          placeholder="Ex. : regard EP difficile d'accès · le fournisseur livre toujours côté est…"
          className="w-full rounded-lg border bg-background px-3 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">{note.trim().length}/140</span>
          <button
            type="button"
            onClick={saveNote}
            disabled={pending || note.trim().length < 3}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-foreground text-background font-medium text-sm px-5 py-2.5 active:scale-[0.99] transition-transform disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            Enregistrer
          </button>
        </div>
      </div>
    )
  }

  // ── État « choix » : Note / Photo ──────────────────────────────────────────
  if (mode === 'choice') {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('note')}
            className="inline-flex items-center justify-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium active:scale-[0.99] transition-transform"
          >
            <Pencil className="h-4 w-4" />
            Note
          </button>
          <button
            type="button"
            onClick={openCamera}
            className="inline-flex items-center justify-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium active:scale-[0.99] transition-transform"
          >
            <Camera className="h-4 w-4" />
            Photo
          </button>
        </div>
        <button type="button" onClick={() => setMode('idle')} className="w-full text-xs text-muted-foreground py-1">
          Annuler
        </button>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="hidden" />
      </div>
    )
  }

  // ── État initial : LE bouton noir ──────────────────────────────────────────
  return (
    <>
      <button
        type="button"
        onClick={() => setMode('choice')}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background px-4 py-3.5 text-sm font-semibold active:scale-[0.99] transition-transform"
      >
        <Camera className="h-4 w-4" />
        Prendre une note ou une photo
      </button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="hidden" />
    </>
  )
}
