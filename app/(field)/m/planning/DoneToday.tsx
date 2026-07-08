'use client'

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

/**
 * « Terminé aujourd'hui » — replié PAR DÉFAUT. Le fait est la chose la moins
 * urgente : il ne doit pas pousser l'important vers le bas. On l'annonce d'une
 * ligne (le compte rassure : « c'est fait »), on le déplie à la demande.
 *
 * Le contenu (rows compactes) est rendu côté serveur et passé en `children` :
 * ce composant ne fait que le rythme d'apparition (plier / déplier).
 */
export function DoneToday({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 pt-1 text-left"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Terminé aujourd&apos;hui ({count})
        </span>
        <span className="h-px flex-1 rounded bg-foreground/[0.06]" />
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && children}
    </div>
  )
}
