'use client'

// Bouton feedback flottant — desktop uniquement (Vincent 2026-05-21).
// Posé dans app/(dashboard)/layout.tsx pour apparaître sur toutes les pages
// manager/admin. Pas sur mobile chef (/m) par choix explicite.
//
// UX :
//   - Bouton rond fixed bottom-right
//   - Click → dialog centré avec textarea + compteur + page actuelle
//   - Submit → POST /api/feedback
//   - Toast succès / erreur selon la raison

import { useEffect, useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { MessageSquare, X } from 'lucide-react'
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
const HINT_SEEN_KEY = 'memoria.feedbackHintSeen'

export function FeedbackButton() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  // Nudge d'accueil : une seule fois (mémorisé), invite à signaler bug/idée.
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (localStorage.getItem(HINT_SEEN_KEY)) return
    } catch { /* localStorage indispo : on montre le nudge quand même */ }
    const t = setTimeout(() => setShowHint(true), 1500) // laisse la page se poser
    return () => clearTimeout(t)
  }, [])

  function markHintSeen() {
    try { localStorage.setItem(HINT_SEEN_KEY, '1') } catch { /* ignore */ }
    setShowHint(false)
  }

  function reset() {
    setMessage('')
  }

  function submit() {
    const trimmed = message.trim()
    if (!trimmed) return
    startTransition(async () => {
      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            page: pathname,
          }),
        })
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
            toast.error('Erreur lors de l’envoi. Réessaie.')
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
      {/* Nudge d'accueil — invite à signaler bug/idée. Une seule fois, desktop. */}
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
            {/* flèche pointant vers la bulle, en bas à droite */}
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
        {/* halo doux tant que le nudge est visible, pour attirer l'œil */}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Envoyer un retour</DialogTitle>
            <DialogDescription>
              Un bug, une suggestion, une frustration ? On lit tout. Pas de réponse
              automatique — l’admin traite manuellement.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_LENGTH))}
              placeholder="Décris ce qui ne va pas ou ce que tu voudrais voir…"
              rows={6}
              disabled={pending}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[120px]"
              autoFocus
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="font-mono truncate">{pathname}</span>
              <span
                className={
                  message.length > MAX_LENGTH * 0.9
                    ? 'text-amber-700 dark:text-amber-300 tabular-nums'
                    : 'tabular-nums'
                }
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
