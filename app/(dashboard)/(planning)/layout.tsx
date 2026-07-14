// LE PLANNING EST UN ESPACE, PAS TROIS PAGES.
//
// Cette mise en page ne se re-rend PAS quand on passe du mois à la semaine ou au
// jour : c'est la garantie du framework, et c'est elle qui produit la sensation
// de zoom plutôt que de navigation. L'en-tête reste sous la main, seul le
// contenu change — comme dans un agenda.
//
// Ce qui FABRIQUE le planning (le planning habituel, les jours fermés) n'est pas
// une échelle de lecture : c'est un réglage. Il vit derrière l'engrenage, là où
// l'on va rarement, jamais dans la barre des échelles.

import type { ReactNode } from 'react'
import { PlanningSpaceHeader } from '@/components/planning/PlanningSpaceHeader'

export default function PlanningLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full space-y-5">
      <PlanningSpaceHeader />
      {children}
    </div>
  )
}
