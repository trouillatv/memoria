'use client'

// Le point d'accès CROSS-SURFACE de la fiche Action : un `?action=<id>` posé
// depuis n'importe quelle porte (fiche personne, recherche, Aujourd'hui, visite,
// décision — Slice 4) ouvre la MÊME fiche par-dessus l'onglet courant. Fermer
// retire le paramètre sans recharger ni perdre l'onglet. Miroir exact du
// patron `?person=` de la fiche Intervenant.

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ActionFicheSheet } from './ActionFiche'
import type { TrailBack } from '@/components/knowledge/FicheTrail'
import type { ActionFicheData } from '@/lib/knowledge/action-fiche'

export function ActionFicheDeepLink({ action }: { action: ActionFicheData }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function close() {
    const next = new URLSearchParams(params.toString())
    next.delete('action')
    next.delete('action_source')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // « Remonter l'histoire » : arrivé depuis la décision d'origine
  // (`action_source=decision`), le retour ramène à CETTE décision — le maillon
  // amont du fil. Toute autre porte (personne, recherche, Aujourd'hui…) = « Fermer ».
  const back: TrailBack | null =
    params.get('action_source') === 'decision' && action.fromDecision
      ? { typeLabel: 'Décision', href: action.fromDecision.href, fromTitle: action.fromDecision.title }
      : null

  return <ActionFicheSheet action={action} onClose={close} back={back} />
}
