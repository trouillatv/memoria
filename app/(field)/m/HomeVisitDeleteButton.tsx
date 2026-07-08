'use client'

// Supprimer une visite DIRECTEMENT depuis « Reprendre mon travail » — sans avoir
// à l'ouvrir. C'est la porte de sortie pour les visites fantômes (vides, tests,
// doublons) qui traînent. Geste en DEUX temps (poubelle → « Supprimer ? ») pour
// ne jamais effacer par accident. Soft-delete : réversible côté base.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { deleteVisitAction } from '@/app/(field)/m/visite/[reportId]/debrief-actions'

export function HomeVisitDeleteButton({
  reportId,
  tone = 'emerald',
  onDeleted,
}: {
  reportId: string
  /** Assortit la couleur au repos à la carte (verte = en cours, ambre = tri). */
  tone?: 'emerald' | 'amber'
  /** Retrait OPTIMISTE : la carte disparaît tout de suite, sans attendre le
   *  rafraîchissement serveur (fiable même si plusieurs cartes se ressemblent). */
  onDeleted?: () => void
}) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [pending, start] = useTransition()

  const restTone =
    tone === 'amber'
      ? 'text-amber-700/50 active:text-amber-700 dark:text-amber-300/40'
      : 'text-emerald-800/40 active:text-emerald-800 dark:text-emerald-300/40'

  function onClick(e: React.MouseEvent) {
    // On est à côté d'un lien « Reprendre / Terminer » : on ne navigue pas.
    e.preventDefault()
    e.stopPropagation()
    if (!armed) {
      setArmed(true)
      return
    }
    start(async () => {
      try {
        const r = await deleteVisitAction({ report_id: reportId })
        if (r.ok) {
          onDeleted?.() // la carte s'efface immédiatement
          toast.success('Visite supprimée', { duration: 1400 })
          router.refresh()
        } else {
          toast.error(r.error ?? 'Suppression impossible')
          setArmed(false)
        }
      } catch {
        toast.error('Suppression impossible — réessayez')
        setArmed(false)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={armed ? 'Confirmer la suppression' : 'Supprimer la visite'}
      className={
        armed
          ? 'inline-flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-2.5 py-1.5 text-[12px] font-semibold text-white active:brightness-95 disabled:opacity-50'
          : `inline-flex shrink-0 items-center justify-center rounded-full p-2 ${restTone}`
      }
    >
      {armed ? (
        <>
          <Check className="h-3.5 w-3.5" /> Supprimer ?
        </>
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  )
}
