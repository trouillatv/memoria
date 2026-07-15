'use client'

// ÉTAT « PLANNING PRÉVU » — le tiroir d'un jour SEULEMENT projeté.
//
// PL6-R2, correction UX (Vincent 2026-07-15) : cliquer une case projetée ne doit
// NI ouvrir un faux tiroir d'intervention (il n'y a rien de matérialisé), NI
// rediriger en silence vers le roulement. On explique d'abord ce qu'on regarde —
// « cette journée vient d'un roulement, rien n'est encore généré » — puis, au
// bouton seulement, on ouvre le roulement du chantier.
//
// Même mécanique que CellDrawer : délégation de clic sur `[data-projected-trigger]`
// dans le conteneur, lecture des `data-*`. Aucune matérialisation à la lecture.

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ArrowRight } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const WEEKDAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']

function formatLongDate(iso: string): string {
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  const [y, m, d] = parts.map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso
  const date = new Date(Date.UTC(y, m - 1, d))
  return `${WEEKDAYS_FR[date.getUTCDay()] ?? ''} ${d} ${MONTHS_FR[m - 1] ?? ''} ${y}`
}

interface Projected {
  siteId: string
  date: string
  siteLabel: string
}

export function MonthProjectionSheet({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Projected | null>(null)

  const handleContainerClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (!target) return
    const trigger = target.closest<HTMLElement>('[data-projected-trigger="true"]')
    if (!trigger) return
    const siteId = trigger.getAttribute('data-site-id')
    const date = trigger.getAttribute('data-date')
    if (!siteId || !date) return
    setSelected({ siteId, date, siteLabel: trigger.getAttribute('data-site-label') ?? 'Ce chantier' })
  }, [])

  return (
    <>
      <div onClick={handleContainerClick} data-slot="month-projection-host">
        {children}
      </div>
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="p-0 sm:max-w-sm w-full overflow-y-auto">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="inline-flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
              Planning prévu
            </SheetTitle>
            <SheetDescription>
              {selected ? `${selected.siteLabel} · ${formatLongDate(selected.date)}` : null}
            </SheetDescription>
          </SheetHeader>

          {selected ? (
            <div className="space-y-4 px-4 py-4">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Issu du roulement</p>
                <p className="text-sm font-medium">{selected.siteLabel}</p>
              </div>
              <p className="text-sm text-muted-foreground">Aucune intervention créée.</p>
              <Link
                href={`/sites/${selected.siteId}/roulements`}
                className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-between')}
              >
                Configurer le roulement
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}
