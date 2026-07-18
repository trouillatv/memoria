'use client'

// Le point d'accès CROSS-SURFACE de la fiche Action : un `?action=<id>` posé
// depuis n'importe quelle porte (fiche personne, recherche, Aujourd'hui, visite,
// décision — Slice 4) ouvre la MÊME fiche par-dessus l'onglet courant. Fermer
// retire le paramètre sans recharger ni perdre l'onglet. Miroir exact du
// patron `?person=` de la fiche Intervenant.

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ActionFicheSheet } from './ActionFiche'
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

  return <ActionFicheSheet action={action} onClose={close} />
}
