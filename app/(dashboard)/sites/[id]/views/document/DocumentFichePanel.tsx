'use client'

// Le panneau de la fiche Document. Mécanisme identique à Réunion, Décision et
// Action : l'URL pilote l'affichage, chaque fiche affichée est notée dans la pile
// du parcours, × / Échap / clic-dehors terminent le parcours en une fois.

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DocumentFicheBody } from './DocumentFiche'
import { quitterEspaceHref, garderContexte } from '../fiche-segment-href'
import { noterFiche, terminerParcours } from '../fiche-espace-historique'
import type { DocumentFicheData } from '@/lib/knowledge/document-fiche'

export function DocumentFichePanel({ document }: { document: DocumentFicheData }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''

  const ouvert = pathname.includes('/document/')

  useEffect(() => { if (ouvert) noterFiche(pathname) }, [ouvert, pathname])

  function quitter() {
    if (!terminerParcours()) router.replace(quitterEspaceHref(pathname, search))
  }

  // Remonter vers la réunion source garde l'onglet courant derrière le panneau.
  const d: DocumentFicheData = document.reunion
    ? { ...document, reunion: { ...document.reunion, href: garderContexte(document.reunion.href, search) ?? document.reunion.href } }
    : document

  if (!ouvert) return null

  return (
    <Sheet open onOpenChange={(o) => { if (!o) quitter() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <DocumentFicheBody document={d} />
      </SheetContent>
    </Sheet>
  )
}
