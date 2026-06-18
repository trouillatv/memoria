'use client'

// Briefing du soir — replie les actions ouvertes PAR SITE (sinon, déroulées,
// il y en a trop). Pattern RSC : la liste d'actions est rendue côté serveur et
// passée en children ; ce composant ne gère que ouvert/fermé. Le nom du site
// reste un lien navigable, distinct du chevron (pas d'interactif imbriqué).

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, ChevronDown } from 'lucide-react'

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
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <MapPin className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
        <Link href={`/sites/${siteId}`} className="text-sm font-medium hover:underline">
          {name}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Replier ${name}` : `Déplier ${name}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <span className="tabular-nums">{count}</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
            aria-hidden
          />
        </button>
      </div>
      {open && children}
    </div>
  )
}
