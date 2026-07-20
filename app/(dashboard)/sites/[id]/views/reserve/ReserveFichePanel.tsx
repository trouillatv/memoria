'use client'

// Le panneau de la fiche Réserve. Mécanisme identique aux trois autres.

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ReserveFicheBody } from './ReserveFiche'
import { quitterEspaceHref, garderContexte } from '../fiche-segment-href'
import { noterFiche, terminerParcours } from '../fiche-espace-historique'
import type { ReserveFicheData } from '@/lib/knowledge/reserve-fiche'

export function ReserveFichePanel({ reserve }: { reserve: ReserveFicheData }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''

  const ouvert = pathname.includes('/reserve/')

  useEffect(() => { if (ouvert) noterFiche(pathname) }, [ouvert, pathname])

  function quitter() {
    if (!terminerParcours()) router.replace(quitterEspaceHref(pathname, search))
  }

  // Suivre une action ou un sujet garde l'onglet courant derrière le panneau.
  const r: ReserveFicheData = {
    ...reserve,
    actions: reserve.actions.map((a) => ({ ...a, href: garderContexte(a.href, search) ?? a.href })),
    sujet: reserve.sujet
      ? { ...reserve.sujet, href: garderContexte(reserve.sujet.href, search) ?? reserve.sujet.href }
      : null,
  }

  if (!ouvert) return null

  return (
    <Sheet open onOpenChange={(o) => { if (!o) quitter() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <ReserveFicheBody reserve={r} />
      </SheetContent>
    </Sheet>
  )
}
