'use client'

// Sprint D — Bouton compact pour résoudre une anomalie depuis le brief.
// Vincent 2026-05-22.
//
// Affiche un bouton "Résoudre" qui ouvre un mini-prompt note optionnelle.
// Action immédiate, pas de modale lourde — c'est un geste de gestion
// quotidienne, pas une décision lourde.
//
// Doctrine [[lien-utile-aide-a-agir]] : le manager AGIT au moment où il
// voit l'anomalie dans le brief, pas dans une autre page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { resolveAnomalyAction } from './actions-anomaly'

interface Props {
  anomalyId: string
}

export function ResolveAnomalyButton({ anomalyId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')

  function resolve() {
    startTransition(async () => {
      const r = await resolveAnomalyAction({
        anomalyId,
        note: note.trim() || undefined,
      })
      if (r.ok) {
        toast.success('Anomalie marquée résolue')
        setConfirming(false)
        setNote('')
        router.refresh()
      } else {
        toast.error(r.error ?? 'Erreur')
      }
    })
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optionnelle)"
          maxLength={500}
          className="h-7 w-32 rounded border bg-background px-2 text-xs"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') resolve()
            if (e.key === 'Escape') setConfirming(false)
          }}
        />
        <button
          type="button"
          onClick={resolve}
          disabled={pending}
          className="h-7 px-2 rounded border border-emerald-600 bg-emerald-600 text-white text-xs hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          OK
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false)
            setNote('')
          }}
          disabled={pending}
          className="h-7 px-2 rounded border border-border text-xs hover:bg-muted"
        >
          Annuler
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100 text-emerald-800 text-[10px] transition-colors dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900"
      title="Marquer cette anomalie comme résolue"
    >
      <Check className="h-3 w-3" />
      Résoudre
    </button>
  )
}
