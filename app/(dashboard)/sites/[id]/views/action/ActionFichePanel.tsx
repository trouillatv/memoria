'use client'

// Le panneau de la fiche Action — SECOND maillon du prototype Lot 3.
// Son existence crée la chaîne Décision → Action, seul terrain où la règle
// « fermer = retour navigateur » peut être éprouvée : c'est là que « revenir d'un
// objet » et « quitter l'espace des fiches » cessent d'être le même geste.

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ActionFicheBody } from './ActionFiche'
import { toSegmentHref, quitterEspaceHref } from '../fiche-segment-href'
import type { ActionFicheData } from '@/lib/knowledge/action-fiche'

export function ActionFichePanel({ action }: { action: ActionFicheData }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''

  // Cf. DecisionFichePanel : une zone parallèle non appariée garde son contenu en
  // navigation client. L'adresse tranche — plus de segment, plus de panneau.
  const ouvert = pathname.includes('/action/')

  // « Découle de : <décision> » — le retour vers l'amont reste dans le modèle.
  const href = toSegmentHref(action.fromDecision?.href, 'decision', pathname, search)
  const a = href && action.fromDecision
    ? { ...action, fromDecision: { ...action.fromDecision, href } }
    : action

  if (!ouvert) return null

  return (
    <Sheet open onOpenChange={(o) => { if (!o) router.replace(quitterEspaceHref(pathname, search)) }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <ActionFicheBody action={a} />
      </SheetContent>
    </Sheet>
  )
}
