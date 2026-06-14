'use client'

// Bouton feedback flottant — desktop uniquement (Vincent 2026-05-21).
// Mise à jour 2026-06-14 :
//   - Capture d'écran : coller avec Ctrl+V dans le dialog
//   - Pièce jointe : bouton "Joindre une image" (file input, images uniquement)
//   - Prévisualisation des images avant envoi (max 3, 5 Mo chacune)
//   - Envoi en FormData pour supporter les fichiers

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { ImagePlus, MessageSquare, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const MAX_LENGTH = 2000
const MAX_ATTACHMENTS = 3
const MAX_FILE_BYTES = 5 * 1024 * 1024  // 5 Mo
const HINT_SEEN_KEY = 'memoria.feedbackHintSeen'

interface Attachment {
  file: File
  preview: string  // Object URL temporaire pour la miniature
}

export function FeedbackButton() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [pending, startTransition] = useTransition()
  const [showHint, setShowHint] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (localStorage.getItem(HINT_SEEN_KEY)) return
    } catch { /* localStorage indispo */ }
    const t = setTimeout(() => setShowHint(true), 1500)
    return () => clearTimeout(t)
  }, [])

  function markHintSeen() {
    try { localStorage.setItem(HINT_SEEN_KEY, '1') } catch { /* ignore */ }
    setShowHint(false)
  }

  function reset() {
    setMessage('')
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.preview))
      return []
    })
  }

  function addFiles(files: FileList | File[]) {
    const toAdd = Array.from(files)
      .filter((f) => f.type.startsWith('image/') && f.size > 0 && f.size <= MAX_FILE_BYTES)
      .slice(0, MAX_ATTACHMENTS - attachments.length)
    if (!toAdd.length) {
      const oversized = Array.from(files).some((f) => f.size > MAX_FILE_BYTES)
      if (oversized) toast.error('Image trop lourde (max 5 Mo).')
      return
    }
    setAttachments((prev) => [
      ...prev,
      ...toAdd.map((f) => ({ file: f, preview: URL.createObjectURL(f) })),
    ])
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  function handlePaste(e: React.ClipboardEvent) {
    if (attachments.length >= MAX_ATTACHMENTS) return
    const images = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null)
    if (images.length > 0) {
      e.preventDefault()
      addFiles(images)
      toast.success('Capture collée.')
    }
  }

  function submit() {
    const trimmed = message.trim()
    if (!trimmed) return
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('message', trimmed)
        fd.set('page', pathname)
        attachments.forEach((a) => fd.append('files', a.file))

        const res = await fetch('/api/feedback', { method: 'POST', body: fd })
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; reason?: string }
          | null

        if (!data?.ok) {
          const reason = data?.reason ?? 'server_error'
          if (reason === 'rate_limited') {
            toast.error('Trop de retours envoyés en peu de temps. Réessaie dans un moment.')
          } else if (reason === 'unauthenticated') {
            toast.error('Session expirée. Reconnecte-toi.')
          } else if (reason === 'message_too_long') {
            toast.error(`Message trop long (max ${MAX_LENGTH} caractères).`)
          } else if (reason === 'empty_message') {
            toast.error('Le message est vide.')
          } else {
            toast.error('Erreur lors de l\'envoi. Réessaie.')
          }
          return
        }
        toast.success('Merci — retour bien reçu.')
        reset()
        setOpen(false)
      } catch {
        toast.error('Erreur réseau. Réessaie.')
      }
    })
  }

  return (
    <>
      {/* Nudge d'accueil — une seule fois */}
      {showHint && !open && (
        <div className="hidden md:block fixed bottom-[5.5rem] right-6 z-40 w-64 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
          <div className="relative rounded-xl border bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/5">
            <button
              type="button"
              onClick={markHintSeen}
              aria-label="Fermer"
              className="absolute top-2 right-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { setOpen(true); markHintSeen() }}
              className="block w-full text-left p-3.5 pr-8"
            >
              <p className="text-sm font-medium">Un souci, un bug, une idée&nbsp;?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Dis-le-moi directement ici&nbsp;— je lis tous les retours.
              </p>
            </button>
            <span className="absolute -bottom-1.5 right-6 h-3 w-3 rotate-45 rounded-[2px] border-b border-r bg-popover" />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => { setOpen(true); if (showHint) markHintSeen() }}
        aria-label="Envoyer un retour"
        title="Envoyer un retour"
        className="hidden md:inline-flex fixed bottom-6 right-6 z-40 items-center justify-center h-11 w-11 rounded-full bg-foreground text-background shadow-lg hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {showHint && (
          <span className="absolute inset-0 rounded-full bg-foreground/20 motion-safe:animate-ping" aria-hidden />
        )}
        <MessageSquare className="relative h-5 w-5" />
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
      >
        {/* onPaste sur le DialogContent capture Ctrl+V même hors du textarea */}
        <DialogContent className="sm:max-w-md" onPaste={handlePaste}>
          <DialogHeader>
            <DialogTitle>Envoyer un retour</DialogTitle>
            <DialogDescription>
              Un bug, une suggestion, une frustration&nbsp;? On lit tout.
              Joins une capture d&apos;écran avec <kbd className="font-mono text-[10px] border rounded px-1">Ctrl+V</kbd> ou le bouton ci-dessous.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_LENGTH))}
              placeholder="Décris ce qui ne va pas ou ce que tu voudrais voir…"
              rows={5}
              disabled={pending}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[100px]"
              autoFocus
            />

            {/* Miniatures des pièces jointes */}
            {attachments.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {attachments.map((a, i) => (
                  <div key={i} className="relative group w-16 h-16 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.preview}
                      alt={`Pièce jointe ${i + 1}`}
                      className="w-16 h-16 object-cover rounded border border-border"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Retirer l'image"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {/* Bouton joindre image */}
                {attachments.length < MAX_ATTACHMENTS && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={pending}
                    title="Joindre une image — ou colle avec Ctrl+V"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded border px-2 py-1 shrink-0 transition-colors disabled:opacity-40"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    {attachments.length === 0
                      ? 'Joindre une image'
                      : `+ image (${attachments.length}/${MAX_ATTACHMENTS})`}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files)
                    e.target.value = ''  // reset pour permettre de re-sélectionner le même fichier
                  }}
                />
                <span className="text-[10px] font-mono text-muted-foreground/60 truncate">
                  {pathname}
                </span>
              </div>
              <span
                className={`tabular-nums text-[11px] shrink-0 ${
                  message.length > MAX_LENGTH * 0.9
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-muted-foreground'
                }`}
              >
                {message.length} / {MAX_LENGTH}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button onClick={submit} disabled={pending || !message.trim()}>
              {pending ? 'Envoi…' : 'Envoyer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
