'use client'

// Point d'accès CROSS-SURFACE de la fiche Décision : un `?decision=<id>` posé
// depuis n'importe quelle porte (fiche Action, fiche Intervenant, recherche…)
// ouvre la MÊME fiche par-dessus l'onglet courant. Fermer retire le paramètre
// sans recharger. Miroir exact du patron `?action=` / `?person=`.

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DecisionFicheSheet } from './DecisionFiche'
import type { TrailBack } from '@/components/knowledge/FicheTrail'
import type { DecisionFicheData } from '@/lib/knowledge/decision-fiche'

export function DecisionFicheDeepLink({ decision }: { decision: DecisionFicheData }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function close() {
    const next = new URLSearchParams(params.toString())
    next.delete('decision')
    next.delete('decision_source')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // « Remonter l'histoire » : quand on est arrivé depuis l'action liée
  // (`decision_source=action`), le retour ramène à CETTE action — le maillon aval
  // du fil. Toute autre porte (intervenant, aperçu, recherche…) reste « Fermer ».
  const back: TrailBack | null =
    params.get('decision_source') === 'action' && decision.action
      ? { typeLabel: 'Action', href: decision.action.href, fromTitle: decision.action.title }
      : null

  return <DecisionFicheSheet decision={decision} onClose={close} back={back} />
}
