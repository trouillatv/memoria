'use client'

// Le panneau de la fiche Observation. Quatrième et dernière application du même
// mécanisme : l'URL pilote l'affichage, la pile note le parcours, × / Échap /
// clic-dehors le terminent en une fois.

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ObservationFicheBody } from './ObservationFiche'
import { quitterEspaceHref, garderContexte } from '../fiche-segment-href'
import { noterFiche, terminerParcours } from '../fiche-espace-historique'
import type { ObservationFicheData } from '@/lib/knowledge/observation-fiche'

export function ObservationFichePanel({ observation }: { observation: ObservationFicheData }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''

  const ouvert = pathname.includes('/observation/')

  useEffect(() => { if (ouvert) noterFiche(pathname) }, [ouvert, pathname])

  function quitter() {
    if (!terminerParcours()) router.replace(quitterEspaceHref(pathname, search))
  }

  // Remonter à la visite, ou suivre ce que l'observation a produit, garde l'onglet.
  const o: ObservationFicheData = {
    ...observation,
    visite: { ...observation.visite, href: garderContexte(observation.visite.href, search) ?? observation.visite.href },
    produits: observation.produits.map((p) => ({ ...p, href: garderContexte(p.href, search) })),
  }

  if (!ouvert) return null

  return (
    <Sheet open onOpenChange={(v) => { if (!v) quitter() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <ObservationFicheBody observation={o} />
      </SheetContent>
    </Sheet>
  )
}
