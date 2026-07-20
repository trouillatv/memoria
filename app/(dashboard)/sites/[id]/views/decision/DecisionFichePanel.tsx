'use client'

// Le panneau de la fiche Décision, version PROTOTYPE Lot 3 : il est monté par la
// zone parallèle `@fiche`, donc son ouverture ne touche pas au contenu de l'onglet.
//
// Fermer = revenir en arrière dans l'historique. C'est le sens exact du geste ici :
// ouvrir la fiche a ajouté une entrée, la fermer la consomme. Plus besoin de
// bricoler l'adresse à la main — et le re-clic refonctionne naturellement, puisque
// l'adresse redevient celle de l'onglet dès la fermeture.

import { useRouter } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DecisionFicheBody } from './DecisionFiche'
import type { DecisionFicheData } from '@/lib/knowledge/decision-fiche'

export function DecisionFichePanel({ decision }: { decision: DecisionFicheData }) {
  const router = useRouter()
  return (
    <Sheet open onOpenChange={(o) => { if (!o) router.back() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <DecisionFicheBody decision={decision} />
      </SheetContent>
    </Sheet>
  )
}
