'use client'

// Le point d'accès CROSS-SURFACE de la fiche : un lien `?person=<id>` posé
// depuis n'importe quelle porte (Explorer, recherche, objets métier) ouvre la
// MÊME fiche, quel que soit l'onglet actif. Fermer retire le paramètre sans
// recharger la page ni perdre l'onglet courant.

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { IntervenantFicheSheet } from './IntervenantFiche'
import type { IntervenantPerson } from '@/lib/knowledge/site-intervenants-view'

export function IntervenantFicheDeepLink({ siteId, person }: { siteId: string; person: IntervenantPerson }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function close() {
    const next = new URLSearchParams(params.toString())
    next.delete('person')
    next.delete('person_source')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return <IntervenantFicheSheet siteId={siteId} person={person} onClose={close} />
}
