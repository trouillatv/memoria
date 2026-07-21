'use client'

// RÉANALYSER — jamais tout seul, et jamais une deuxième mécanique.
//
// Le bouton appelle exactement l'action du terrain (`getVisitDebriefFieldAction`
// avec force) : un seul chemin pour le verbe « comprendre », deux surfaces. Ce
// qui change entre elles, c'est l'usage — sur le chantier « j'ai oublié une
// photo », au bureau « en relisant le dossier, je complète ».
//
// L'appel coûte une lecture par le modèle : il ne part donc QUE sur un clic, et
// seulement quand des preuves sont réellement entrées depuis la dernière
// synthèse. Le récit constate ; l'humain décide.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { getVisitDebriefFieldAction } from '@/app/(field)/m/visite/[reportId]/debrief-actions'

export function ReanalyseButton({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function relire() {
    setError(null)
    setRunning(true)
    start(async () => {
      const res = await getVisitDebriefFieldAction({ report_id: reportId, force: true })
      setRunning(false)
      if (!res.ok) {
        setError(res.error)
        return
      }
      // Les nouvelles propositions viennent du serveur : on relit la page plutôt
      // que de recomposer un état local qui dirait la même chose en moins sûr.
      router.refresh()
    })
  }

  const busy = pending || running

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={relire}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-background px-3 py-1.5 text-[13px] font-medium hover:bg-amber-100/50 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-950/40"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        {busy ? 'MemorIA relit la visite…' : 'Réanalyser'}
      </button>
      {error && <span className="text-[12px] text-rose-600 dark:text-rose-400">{error}</span>}
    </span>
  )
}
