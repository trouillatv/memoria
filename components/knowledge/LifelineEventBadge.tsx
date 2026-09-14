'use client'

import Link from 'next/link'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface LifelineEventPreview {
  title: string
  date: string | null
  status: string | null
  /** Uniquement si structuré (contact/entreprise liée) — jamais un texte libre, jamais un « — ». */
  responsible: string | null
}

function frDateLong(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Aperçu contextuel au survol/tap d'une pastille de la ligne de vie (fiche Sujet).
 * Desktop : hover/focus ouvre. Mobile : tap ouvre, tap hors du popover ferme (comportement
 * par défaut de Base UI Popover). Jamais de requête ici — tout le contenu est déjà résolu
 * en amont (lib/db/canonical-subject-life.ts), une seule fois pour toute la page.
 */
export function LifelineEventBadge({
  typeLabel,
  badgeLabel,
  colorClass,
  events,
  sourceLabel,
  sourceHref,
}: {
  typeLabel: string
  badgeLabel: string
  colorClass: string
  events: LifelineEventPreview[]
  sourceLabel: string | null
  sourceHref: string | null
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={`Aperçu — ${badgeLabel}`}
        className={cn(
          'cursor-pointer whitespace-nowrap rounded-full px-1.5 py-px text-[9px] font-semibold leading-4 outline-none transition-transform hover:scale-110 hover:opacity-90 active:scale-95 data-[popup-open]:scale-110 data-[popup-open]:ring-2 data-[popup-open]:ring-ring/40',
          colorClass,
        )}
      >
        {badgeLabel}
      </PopoverTrigger>
      <PopoverContent>
        <div className="space-y-2.5">
          {events.map((ev, i) => (
            <div key={i} className={i > 0 ? 'border-t pt-2.5' : ''}>
              <p className="font-semibold text-foreground">
                {ev.date ? `${frDateLong(ev.date)} · ${typeLabel}` : typeLabel}
              </p>
              <p className="mt-0.5 leading-snug text-foreground">{ev.title}</p>
              {ev.status && <p className="mt-0.5 text-muted-foreground">{ev.status}</p>}
              {ev.responsible && <p className="mt-0.5 text-muted-foreground">{ev.responsible}</p>}
            </div>
          ))}
          {sourceLabel && (
            <p className="border-t pt-2 text-muted-foreground">
              Source :{' '}
              {sourceHref ? (
                <Link href={sourceHref} className="underline hover:no-underline">{sourceLabel}</Link>
              ) : sourceLabel}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
