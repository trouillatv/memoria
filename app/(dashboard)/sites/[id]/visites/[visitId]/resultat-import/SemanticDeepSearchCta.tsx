'use client'

// P-UI-R2d — CTA « recherche approfondie » sur le résultat d'import.
//
// Ne s'affiche QUE lorsque le feed sémantique a été DIFFÉRÉ (coût > budget automatique) :
// sur un petit import, le rapprochement sémantique a déjà tourné tout seul et ce composant
// n'est pas rendu. Jamais silencieux, jamais imposé : l'humain choisit de lancer maintenant.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { runSemanticDeepSearchAction } from '../../../historique/similarity-actions'

export function SemanticDeepSearchCta({
  siteId,
  reportId,
  candidateCount,
}: {
  siteId: string
  reportId: string
  candidateCount: number
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [created, setCreated] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const run = async () => {
    setState('running')
    setMessage(null)
    const result = await runSemanticDeepSearchAction(siteId, reportId)
    if (result.error) { setState('error'); setMessage(result.error); return }
    setCreated(result.created ?? 0)
    setState('done')
    // Rafraîchir la page serveur : les nouvelles suggestions apparaissent, le CTA disparaît.
    router.refresh()
  }

  if (state === 'done') {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-[13.5px] dark:border-violet-900 dark:bg-violet-950/20">
        <p className="font-medium text-violet-700 dark:text-violet-300">
          {created && created > 0
            ? `${created} rapprochement${created > 1 ? 's' : ''} supplémentaire${created > 1 ? 's' : ''} à examiner`
            : 'Aucun rapprochement supplémentaire trouvé'}
        </p>
        {created && created > 0 && (
          <p className="mt-1 text-muted-foreground">Ils apparaissent ci-dessus dès que la page se rafraîchit.</p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/20">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">Recherche approfondie de rapprochements disponible</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {candidateCount} comparaison{candidateCount > 1 ? 's' : ''} possible{candidateCount > 1 ? 's' : ''} avec la
            mémoire existante — au-delà de l’analyse automatique. Elle peut révéler des continuités formulées
            différemment.
          </p>
          {state === 'error' && message && (
            <p className="mt-1.5 text-[13px] text-destructive">{message}</p>
          )}
          <button
            type="button"
            disabled={state === 'running'}
            onClick={run}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {state === 'running' ? 'Recherche en cours…' : 'Rechercher les rapprochements'}
          </button>
        </div>
      </div>
    </div>
  )
}
