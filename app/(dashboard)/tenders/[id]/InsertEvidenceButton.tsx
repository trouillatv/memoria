'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { insertEvidenceIntoMemoire } from './actions'

interface InsertEvidenceButtonProps {
  tenderId: string
  engagementId: string
  alreadyInserted: boolean
}

/**
 * Slice 4.3 — Bouton "Insérer dans la mémoire".
 *
 * Wrappe la server action `insertEvidenceIntoMemoire` avec feedback visuel
 * (loading via useTransition, success → bouton vert disabled, error inline).
 *
 * État optimiste : la card switch immédiatement en "inséré" après succès,
 * sans attendre le revalidatePath côté serveur.
 */
export function InsertEvidenceButton({
  tenderId,
  engagementId,
  alreadyInserted: initialAlreadyInserted,
}: InsertEvidenceButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [alreadyInserted, setAlreadyInserted] = useState(initialAlreadyInserted)
  const [error, setError] = useState<string | null>(null)

  const handleClick = () => {
    setError(null)
    startTransition(async () => {
      const result = await insertEvidenceIntoMemoire({ tenderId, engagementId })
      if (result.ok) {
        setAlreadyInserted(true)
      } else {
        setError(result.error ?? 'Échec')
      }
    })
  }

  if (alreadyInserted) {
    return (
      <button
        type="button"
        disabled
        className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded border bg-emerald-50 border-emerald-200 text-xs text-emerald-700 cursor-default"
      >
        <CheckCircle2 className="h-3 w-3" />
        Déjà dans la mémoire
      </button>
    )
  }

  return (
    <div className="flex-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded border bg-card hover:bg-muted/50 border-border text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-wait"
      >
        {isPending ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Insertion…
          </>
        ) : (
          <>
            <Sparkles className="h-3 w-3" />
            Insérer dans la mémoire
          </>
        )}
      </button>
      {error && (
        <div className="text-[10px] text-rose-600 mt-1">{error}</div>
      )}
    </div>
  )
}
