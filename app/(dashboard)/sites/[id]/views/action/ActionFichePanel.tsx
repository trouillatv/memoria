'use client'

// Le panneau de la fiche Action — SECOND maillon du prototype Lot 3.
// Son existence crée la chaîne Décision → Action, seul terrain où la règle
// « fermer = retour navigateur » peut être éprouvée : c'est là que « revenir d'un
// objet » et « quitter l'espace des fiches » cessent d'être le même geste.

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ActionFicheBody } from './ActionFiche'
import { quitterEspaceHref, garderContexte } from '../fiche-segment-href'
import { noterFiche, terminerParcours } from '../fiche-espace-historique'
import type { ActionFicheData } from '@/lib/knowledge/action-fiche'

export function ActionFichePanel({ action }: { action: ActionFicheData }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''

  // Cf. DecisionFichePanel : OBSERVÉ chez nous — après un `router.replace(...)`, la
  // zone parallèle a gardé son contenu. On pilote donc l'affichage par l'URL, sans
  // en déduire une règle générale du framework.
  const ouvert = pathname.includes('/action/')

  // Cf. fiche-espace-historique : on suit le parcours pour savoir combien
  // d'entrées la sortie devra consommer.
  useEffect(() => { if (ouvert) noterFiche(pathname) }, [ouvert, pathname])

  function quitter() {
    if (!terminerParcours()) router.replace(quitterEspaceHref(pathname, search))
  }

  // « Découle de : <décision> » — adresse canonique produite par le read model ;
  // il ne lui manque que le contexte de l'onglet courant.
  const a = action.fromDecision
    ? { ...action, fromDecision: { ...action.fromDecision, href: garderContexte(action.fromDecision.href, search) ?? action.fromDecision.href } }
    : action

  if (!ouvert) return null

  return (
    <Sheet open onOpenChange={(o) => { if (!o) quitter() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <ActionFicheBody action={a} />
      </SheetContent>
    </Sheet>
  )
}
