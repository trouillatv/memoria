'use client'

// Le panneau de la fiche Décision, version PROTOTYPE Lot 3 : il est monté par la
// zone parallèle `@fiche`, donc son ouverture ne touche pas au contenu de l'onglet.
//
// Fermer = revenir en arrière dans l'historique. C'est le sens exact du geste ici :
// ouvrir la fiche a ajouté une entrée, la fermer la consomme.
//
// ⚠️ C'est précisément cette règle que le second maillon doit éprouver : dès qu'on
// enchaîne Décision → Action, « fermer l'espace » et « revenir d'un objet »
// deviennent deux intentions distinctes qui ne correspondent plus au même état
// d'historique. Si la règle ne tient plus, il faudra redonner au × sa sémantique.

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DecisionFicheBody } from './DecisionFiche'
import { toSegmentHref } from '../fiche-segment-href'
import type { DecisionFicheData } from '@/lib/knowledge/decision-fiche'

export function DecisionFichePanel({ decision }: { decision: DecisionFicheData }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''

  // La relation « Produit : <action> » doit rester DANS le nouveau modèle, sinon
  // la chaîne se brise et retombe sur l'ancien chemin par paramètres.
  const href = toSegmentHref(decision.action?.href, 'action', pathname, search)
  const d = href && decision.action
    ? { ...decision, action: { ...decision.action, href } }
    : decision

  return (
    <Sheet open onOpenChange={(o) => { if (!o) router.back() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <DecisionFicheBody decision={d} />
      </SheetContent>
    </Sheet>
  )
}
