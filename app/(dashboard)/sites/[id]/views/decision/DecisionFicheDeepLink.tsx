'use client'

// Point d'accès CROSS-SURFACE de la fiche Décision : un `?decision=<id>` posé
// depuis n'importe quelle porte (fiche Action, fiche Intervenant, recherche…)
// ouvre la MÊME fiche par-dessus l'onglet courant. Fermer retire le paramètre
// sans recharger. Miroir exact du patron `?action=` / `?person=`.

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DecisionFicheSheet } from './DecisionFiche'
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

  return <DecisionFicheSheet decision={decision} onClose={close} />
}
