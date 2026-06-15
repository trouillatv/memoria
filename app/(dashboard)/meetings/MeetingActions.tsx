'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { deleteMeetingAction, cleanupDraftMeetingsAction } from './actions'

// Bouton corbeille par réunion (placé en overlay sur la carte cliquable).
export function DeleteMeetingButton({ reportId, label }: { reportId: string; label: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Supprimer « ${label} » ? Cette réunion (et son audio/transcription) sera retirée. Les actions/notes déjà créées sont conservées.`)) return
    startTransition(async () => {
      const r = await deleteMeetingAction(reportId)
      if (!r.ok) toast.error(r.error)
      else { toast.success('Réunion supprimée'); router.refresh() }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label="Supprimer la réunion"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  )
}

// Nettoyage en masse des brouillons + échecs (test).
export function CleanupDraftMeetingsButton({ count }: { count: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  if (count === 0) return null

  function handleClick() {
    if (!confirm(`Supprimer les ${count} réunion(s) en brouillon ou en échec ? (les réunions analysées/validées sont conservées)`)) return
    startTransition(async () => {
      const r = await cleanupDraftMeetingsAction()
      if (!r.ok) toast.error(r.error)
      else { toast.success(`${r.deleted} réunion(s) nettoyée(s)`); router.refresh() }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      Nettoyer brouillons/échecs ({count})
    </button>
  )
}
