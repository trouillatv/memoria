'use client'

// L'EXCEPTION SE VOIT, ET SE DÉFAIT.
//
// Une occurrence qui dévie de son roulement en silence ferait mentir la grille :
// Guillaume lirait « équipe Nord » dans le roulement et verrait l'équipe Sud sur
// le terrain, sans savoir pourquoi. Alors on le DIT — et on offre le retour.
//
// « Revenir au roulement » restaure ce que le rythme PRESCRIT, relu au moment du
// geste — pas ce qu'on croit se rappeler. Le roulement n'a jamais bougé : c'est
// ce qui rend le retour possible.

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Undo2, GitCommitHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { revertOccurrenceAction } from './occurrence-actions'

export function ExceptionBadge({
  interventionId,
  deviations,
}: {
  interventionId: string
  /** « Jour déplacé », « Équipe changée »… Vide = conforme au roulement. */
  deviations: string[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  // Conforme : une seule ligne, calme. On rappelle juste d'où vient l'occurrence
  // — et que la modifier ne touchera QUE ce jour.
  if (deviations.length === 0) {
    return (
      <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <GitCommitHorizontal className="h-3 w-3 shrink-0" aria-hidden />
        Issue d’un roulement — toute modification ne touche que ce jour.
      </p>
    )
  }

  function revert() {
    if (pending) return
    start(async () => {
      const r = await revertOccurrenceAction(interventionId)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(r.message)
      router.refresh()
    })
  }

  return (
    <div
      data-testid={`exception-${interventionId}`}
      className="space-y-1.5 rounded-md border border-violet-200 bg-violet-50/60 px-2.5 py-2"
    >
      <p className="inline-flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-800">
        <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden />
        Exception au roulement
      </p>
      <p className="text-xs text-violet-900">
        {deviations.join(' · ')} — pour ce jour seulement. Le roulement n’a pas changé.
      </p>
      <button
        type="button"
        onClick={revert}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-white px-2 py-1 text-xs font-medium text-violet-900 transition-colors hover:bg-violet-100 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Undo2 className="h-3.5 w-3.5" />
        )}
        Revenir au roulement
      </button>
    </div>
  )
}
