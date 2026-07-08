'use client'

// Supprimer une visite NON CONCLUANTE (test, doublon, rien de notable). Geste
// volontaire, confirme en deux temps. Soft-delete cote serveur : la visite quitte
// « Reprendre mon travail », la liste des visites, et n'est plus ouvrable.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteVisitAction } from './debrief-actions'

export function DeleteVisitButton({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [pending, start] = useTransition()

  function remove() {
    start(async () => {
      const r = await deleteVisitAction({ report_id: reportId })
      if (r.ok) {
        toast.success('Visite supprimée', { duration: 1500 })
        router.push('/m')
      } else {
        toast.error(r.error ?? 'Suppression impossible')
      }
    })
  }

  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground active:text-destructive"
      >
        <Trash2 className="h-4 w-4" /> Supprimer cette visite
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5">
      <span className="w-full text-center text-[13px] text-muted-foreground">
        Supprimer cette visite ? Elle n’est pas concluante — elle quittera votre liste.
      </span>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        disabled={pending}
        className="rounded-lg border px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
      >
        Annuler
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-lg bg-destructive px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Supprimer
      </button>
    </div>
  )
}
