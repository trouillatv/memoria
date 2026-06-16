'use client'

// Bouton compact qui déplie un panneau (2026-06-16). « Bouttonifie » la fiche
// site : au lieu de gros blocs toujours ouverts, des boutons qu'on ouvre.
// Pattern RSC : le contenu (children) est rendu par le serveur, ce composant
// client ne gère que l'état ouvert/fermé.
//
// `count` : si > 0, le bouton passe en NOIR (signal « il y a quelque chose »).

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export function TogglePanel({
  label,
  count,
  icon,
  defaultOpen = false,
  children,
}: {
  label: string
  count?: number
  icon?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const emphasized = (count ?? 0) > 0

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`w-full sm:w-auto inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors active:scale-[0.99] ${
          emphasized
            ? 'border-foreground bg-foreground text-background'
            : 'border-border bg-card hover:bg-muted/40'
        }`}
      >
        {icon}
        <span>{label}</span>
        {count !== undefined && (
          <span className={emphasized ? 'opacity-80' : 'text-muted-foreground'}>({count})</span>
        )}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''} ${emphasized ? '' : 'text-muted-foreground'}`} />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}
