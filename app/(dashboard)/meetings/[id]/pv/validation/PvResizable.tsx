'use client'

// Glissière PDF (Vincent 2026-06-20) : « pouvoir glisser la flèche jusqu'à une
// certaine limite, pour qu'on puisse lire les deux ». L'aperçu CR (droite) est
// redimensionnable par une poignée ; largeur bornée pour garder l'édition lisible.
// Desktop seulement (lg+) ; en mobile, l'aperçu passe dessous, pleine largeur.
//
// PIÈGE résolu : pendant le drag, le curseur passe AU-DESSUS de l'iframe PDF, qui
// capte les pointermove → le drag se figeait. Fix = setPointerCapture sur la poignée
// (les événements lui restent adressés même au-dessus de l'iframe) + iframe neutralisée
// (pointer-events:none) pendant le glissement.
import { useCallback, useEffect, useRef, useState } from 'react'

const MIN = 360 // px — en-dessous l'aperçu PDF devient illisible
const MAX = 1100 // px — au-delà l'édition est trop écrasée
const DEFAULT = 384 // 24rem (largeur historique)
const KEEP_LEFT = 380 // px réservés au minimum à la colonne d'édition
const STORAGE_KEY = 'pv-preview-width'

export function PvResizable({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT)
  const [dragging, setDragging] = useState(false)

  // Restaure la largeur choisie (confort entre deux ouvertures).
  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    if (saved >= MIN && saved <= MAX) setWidth(saved)
  }, [])

  const clamp = useCallback((px: number) => {
    const container = containerRef.current
    const hardMax = container ? Math.min(MAX, container.clientWidth - KEEP_LEFT) : MAX
    return Math.max(MIN, Math.min(hardMax, px))
  }, [])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId) // garde le drag même au-dessus de l'iframe
    setDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    // Largeur de l'aperçu = distance du curseur au bord droit du conteneur.
    setWidth(clamp(rect.right - e.clientX))
  }

  function endDrag() {
    if (!dragging) return
    setDragging(false)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem(STORAGE_KEY, String(width))
  }

  return (
    <div ref={containerRef} className="flex flex-col lg:flex-row lg:items-start lg:gap-0">
      <div className="min-w-0 space-y-6 lg:flex-1">{left}</div>

      {/* Poignée de glissement (desktop) — hit area large, pointer capture. */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Glisser pour agrandir / réduire l'aperçu (double-clic = défaut)"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => { setWidth(DEFAULT); localStorage.setItem(STORAGE_KEY, String(DEFAULT)) }}
        className="group hidden shrink-0 cursor-col-resize touch-none select-none items-center justify-center self-stretch px-1.5 lg:flex"
      >
        <div className={`h-20 w-1.5 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-border group-hover:bg-primary/60'}`} />
      </div>

      {/* Aperçu : largeur pilotée (desktop) ; pleine largeur forcée en mobile.
          Pendant le drag, on neutralise l'iframe pour que le curseur ne soit pas « avalé ». */}
      <aside
        style={{ width }}
        className={`mt-6 max-lg:!w-full lg:mt-0 lg:shrink-0 lg:sticky lg:top-4 ${dragging ? '[&_iframe]:pointer-events-none' : ''}`}
      >
        {right}
      </aside>
    </div>
  )
}
