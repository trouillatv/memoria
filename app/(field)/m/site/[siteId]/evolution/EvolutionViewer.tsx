'use client'

// « Regarde l'évolution » — le comparateur d'une série de photos de référence
// (mig 195). Même cadrage, dates différentes : on FAIT GLISSER (doigt ou
// curseur) et le chantier se transforme sous les yeux. Déterministe, zéro IA —
// la valeur vient de l'alignement fait par le conducteur à la prise de vue.

import { useCallback, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface EvolutionPhoto {
  url: string
  /** « mardi 24 juin » — date réelle de la prise de vue (fuseau chantier). */
  dateLabel: string
}

export function EvolutionViewer({ photos }: { photos: EvolutionPhoto[] }) {
  const [index, setIndex] = useState(photos.length - 1) // on arrive sur AUJOURD'HUI
  const touchX = useRef<number | null>(null)

  const go = useCallback(
    (next: number) => setIndex(Math.min(photos.length - 1, Math.max(0, next))),
    [photos.length],
  )

  if (photos.length === 0) return null
  const current = photos[index]

  return (
    <div className="space-y-3" data-testid="evolution-viewer">
      {/* La photo, plein cadre. Swipe gauche/droite = avancer/reculer dans le temps. */}
      <div
        className="relative overflow-hidden rounded-2xl border bg-black"
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
        onTouchEnd={(e) => {
          if (touchX.current == null) return
          const dx = e.changedTouches[0].clientX - touchX.current
          touchX.current = null
          if (Math.abs(dx) < 40) return
          go(index + (dx < 0 ? 1 : -1))
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.url} alt="" className="aspect-[3/4] w-full object-cover" />
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white first-letter:uppercase">
          {current.dateLabel}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] tabular-nums text-white/90">
          {index + 1} / {photos.length}
        </span>
      </div>

      {/* Le GLISSEUR du temps — le geste de la démonstration. */}
      <div className="flex items-center gap-2 px-1">
        <button
          type="button" onClick={() => go(index - 1)} disabled={index === 0}
          aria-label="Photo précédente" className="rounded-full border p-2 disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input
          type="range"
          min={0}
          max={photos.length - 1}
          value={index}
          onChange={(e) => go(Number(e.target.value))}
          aria-label="Faire défiler la série dans le temps"
          className="h-2 w-full accent-emerald-600"
        />
        <button
          type="button" onClick={() => go(index + 1)} disabled={index === photos.length - 1}
          aria-label="Photo suivante" className="rounded-full border p-2 disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <p className="px-1 text-center text-[11px] text-muted-foreground">
        Du {photos[0].dateLabel} à aujourd&apos;hui — faites glisser.
      </p>
    </div>
  )
}
