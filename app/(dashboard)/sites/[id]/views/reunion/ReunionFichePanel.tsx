'use client'

// Le panneau de la fiche Réunion. Strictement le même mécanisme que Décision et
// Action — c'est le signe que le Lot 4 applique un cadre au lieu d'en inventer un :
//   · l'affichage est piloté par l'URL (plus de segment, plus de panneau) ;
//   · chaque fiche affichée est notée dans la pile du parcours ;
//   · × / Échap / clic-dehors terminent le parcours EN UNE FOIS (invariant de
//     sortie), le Précédent du navigateur remonte d'un maillon.

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ReunionFicheBody } from './ReunionFiche'
import { quitterEspaceHref, garderContexte } from '../fiche-segment-href'
import { noterFiche, terminerParcours } from '../fiche-espace-historique'
import type { ReunionFicheData } from '@/lib/knowledge/reunion-fiche'

export function ReunionFichePanel({ reunion }: { reunion: ReunionFicheData }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''

  const ouvert = pathname.includes('/reunion/')

  useEffect(() => { if (ouvert) noterFiche(pathname) }, [ouvert, pathname])

  function quitter() {
    if (!terminerParcours()) router.replace(quitterEspaceHref(pathname, search))
  }

  // Les décisions produites sont déjà des adresses de segment : il ne leur manque
  // que le contexte de l'onglet courant.
  const r: ReunionFicheData = {
    ...reunion,
    decisions: reunion.decisions.map((d) => ({ ...d, href: garderContexte(d.href, search) ?? d.href })),
  }

  if (!ouvert) return null

  return (
    <Sheet open onOpenChange={(o) => { if (!o) quitter() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <ReunionFicheBody reunion={r} />
      </SheetContent>
    </Sheet>
  )
}
