'use client'

// Agrandir la carte du CR (Lot 3, sous-point Vincent 2026-08-26) : simple
// réutilisation de CaptureMap en plein écran, STRICTEMENT scopée à la visite
// courante (mêmes `captures` que la petite carte, aucune agrégation
// multi-visite) — pas la future Mémoire spatiale du chantier.

import { useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import { CaptureMap, type MapCapture } from '@/components/CaptureMap'

export function CrMapExpandable({ siteId, captures }: { siteId: string; captures: MapCapture[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <div className="relative">
        <CaptureMap siteId={siteId} captures={captures} heightClass="h-60" />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Agrandir la carte"
          className="absolute right-2 top-2 z-[10] inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1.5 text-xs font-medium text-foreground shadow active:opacity-70 dark:bg-black/80"
        >
          <Maximize2 className="h-3.5 w-3.5" /> Agrandir
        </button>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black">
          <div className="flex items-center justify-between px-3 py-2 text-white">
            <button type="button" onClick={() => setExpanded(false)} aria-label="Fermer" className="rounded-full bg-white/10 p-2">
              <X className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium">Localisation des observations</span>
            <span className="w-9" aria-hidden />
          </div>
          <div className="flex-1 overflow-hidden p-2 safe-bottom">
            <CaptureMap siteId={siteId} captures={captures} heightClass="h-full" />
          </div>
        </div>
      )}
    </>
  )
}
