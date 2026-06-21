'use client'

// Glissière de la page AO (Vincent 2026-06-22) : « pouvoir déplacer la partie
// gauche sur la droite ». La barre latérale (gauche) est redimensionnable par une
// poignée ; largeur bornée pour garder le contenu lisible. Desktop seulement (md+) ;
// en mobile, la sidebar passe au-dessus, pleine largeur. Largeur mémorisée.
import { useCallback, useEffect, useRef, useState } from 'react'

const MIN = 220
const MAX = 640
const DEFAULT = 280
const KEEP_RIGHT = 420 // px réservés au minimum au contenu
const STORAGE_KEY = 'tender-left-width'

export function TenderResizable({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // Largeur mémorisée, lue au montage (client-only).
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved >= MIN && saved <= MAX) setWidth(saved)
  }, [])

  const clamp = useCallback((px: number) => {
    const c = containerRef.current
    const hardMax = c ? Math.min(MAX, c.clientWidth - KEEP_RIGHT) : MAX
    return Math.max(MIN, Math.min(hardMax, px))
  }, [])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    // Largeur de la gauche = distance du curseur au bord gauche du conteneur.
    setWidth(clamp(e.clientX - rect.left))
  }
  function endDrag() {
    if (!dragging) return
    setDragging(false)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem(STORAGE_KEY, String(width))
  }

  return (
    <div ref={containerRef} className="flex flex-col md:flex-row md:items-start md:gap-0">
      {/* Gauche : largeur pilotée (desktop) ; pleine largeur forcée en mobile. */}
      <div style={{ width }} className="max-md:!w-full md:shrink-0">
        {left}
      </div>

      {/* Poignée de glissement (desktop) — hit area large, pointer capture. */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Glisser pour élargir / réduire la barre latérale (double-clic = défaut)"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => { setWidth(DEFAULT); localStorage.setItem(STORAGE_KEY, String(DEFAULT)) }}
        className="group hidden shrink-0 cursor-col-resize touch-none select-none items-center justify-center self-stretch px-1.5 md:flex"
      >
        <div className={`h-20 w-1.5 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-border group-hover:bg-primary/60'}`} />
      </div>

      {/* Contenu : remplit le reste. */}
      <div className="min-w-0 md:flex-1 md:pl-2">{right}</div>
    </div>
  )
}
