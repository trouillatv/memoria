'use client'

// Section repliable réutilisable (pattern RSC : le contenu est rendu côté
// serveur et passé en children ; ce composant client ne gère que ouvert/fermé).
// Utilisé sur la fiche site pour « Mémoire du lieu » et « Événements ».

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export function FoldableSection({
  title,
  titleClassName,
  defaultOpen = true,
  className,
  bodyClassName,
  children,
}: {
  title: React.ReactNode
  titleClassName?: string
  defaultOpen?: boolean
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={titleClassName}>{title}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
          aria-hidden
        />
      </button>
      {open && <div className={bodyClassName}>{children}</div>}
    </div>
  )
}
