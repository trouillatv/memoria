'use client'

// Briefing du soir — replie les actions ouvertes PAR SITE (sinon, déroulées,
// il y en a trop). Pattern RSC : la liste d'actions est rendue côté serveur et
// passée en children ; ce composant ne gère que ouvert/fermé. L'en-tête est une
// barre cliquable explicite (chevron + badge), le lien vers le site est séparé.

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, ChevronDown, ArrowUpRight } from 'lucide-react'

export function CollapsibleSiteActions({
  siteId,
  name,
  count,
  defaultOpen = false,
  children,
}: {
  siteId: string
  name: string
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
          open ? 'bg-muted/40 border-foreground/15' : 'bg-card hover:bg-muted/30'
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left min-w-0"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-foreground/70 transition-transform ${open ? '' : '-rotate-90'}`}
            aria-hidden
          />
          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium truncate">{name}</span>
          <span className="ml-auto shrink-0 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-semibold tabular-nums">
            {count}
          </span>
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
            {open ? 'Masquer' : 'Voir'}
          </span>
        </button>
        <Link
          href={`/sites/${siteId}`}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Ouvrir la fiche du site ${name}`}
        >
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      {open && <div className="mt-1.5 pl-1">{children}</div>}
    </div>
  )
}
