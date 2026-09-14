'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { SiteCompanyFicheBody } from './SiteCompanyFiche'
import { quitterEspaceHref } from '../fiche-segment-href'
import { noterFiche, terminerParcours } from '../fiche-espace-historique'
import type { ConsolidatedIntervenant } from '@/lib/knowledge/site-intervenants-consolidated'

export function SiteCompanyFichePanel({ company }: { company: ConsolidatedIntervenant }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''
  const ouvert = pathname.includes('/entreprise/')
  useEffect(() => { if (ouvert) noterFiche(pathname) }, [ouvert, pathname])
  function quitter() {
    if (!terminerParcours()) router.replace(quitterEspaceHref(pathname, search))
  }
  if (!ouvert) return null
  return (
    <Sheet open onOpenChange={(o) => { if (!o) quitter() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SiteCompanyFicheBody company={company} search={search} />
      </SheetContent>
    </Sheet>
  )
}
