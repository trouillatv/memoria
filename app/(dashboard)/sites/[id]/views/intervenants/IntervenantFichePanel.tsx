'use client'

// Le panneau de la fiche Intervenant, à son ADRESSE canonique.
//
// Septième objet à entrer dans le modèle d'adresses — et le seul dont la fiche
// existait déjà : elle était ouverte par un paramètre (`?person=`), donc sans
// adresse propre, sans page directe, et absente de l'historique comme objet.
// Le corps (`IntervenantFicheBody`) et son read model ne changent pas : ce lot
// n'ajoute que la couche d'adresse, exactement comme pour les objets du Lot 4.

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { IntervenantFicheBody } from './IntervenantFiche'
import { quitterEspaceHref } from '../fiche-segment-href'
import { noterFiche, terminerParcours } from '../fiche-espace-historique'
import type { IntervenantPerson } from '@/lib/knowledge/site-intervenants-view'

export function IntervenantFichePanel({ siteId, person }: { siteId: string; person: IntervenantPerson }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''

  const ouvert = pathname.includes('/intervenant/')

  useEffect(() => { if (ouvert) noterFiche(pathname) }, [ouvert, pathname])

  function quitter() {
    if (!terminerParcours()) router.replace(quitterEspaceHref(pathname, search))
  }

  if (!ouvert) return null

  return (
    <Sheet open onOpenChange={(o) => { if (!o) quitter() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <IntervenantFicheBody siteId={siteId} person={person} search={search} />
      </SheetContent>
    </Sheet>
  )
}
