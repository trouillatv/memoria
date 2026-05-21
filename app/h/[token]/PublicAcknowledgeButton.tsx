'use client'

// Sprint D' — Bouton "C'est lu, j'ai compris" sur la page publique /h/[token].
// Vincent 2026-05-22.
//
// Joseph ouvre le lien sans login, parcourt le brief, confirme qu'il est
// prêt à reprendre la suite. Côté admin, le brief bascule en 'acknowledged'.
//
// Doctrine [[brief-moment-magique]] : le clic est tracé, pas de friction.

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { acknowledgeBriefByTokenAction } from './actions-public'

interface Props {
  token: string
}

export function PublicAcknowledgeButton({ token }: Props) {
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    startTransition(async () => {
      const r = await acknowledgeBriefByTokenAction({ token })
      if (r.ok) {
        setDone(true)
        setError(null)
      } else {
        setError(r.error ?? 'Erreur')
      }
    })
  }

  if (done) {
    return (
      <div className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-sm font-medium">
        <CheckCircle2 className="h-4 w-4" />
        Merci. C'est noté côté MemorIA.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 h-11 sm:h-12 px-5 sm:px-6 rounded-md bg-brand-600 text-white text-sm sm:text-base font-medium hover:bg-brand-700 disabled:opacity-60 transition-colors touch-manipulation"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        C'est lu, j'ai compris
      </button>
      {error && (
        <p className="text-xs text-rose-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
