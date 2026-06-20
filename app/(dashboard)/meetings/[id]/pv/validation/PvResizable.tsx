'use client'

// Glissière PDF (Vincent 2026-06-20) : « pouvoir glisser la flèche jusqu'à une
// certaine limite, pour qu'on puisse lire les deux ». L'aperçu CR (droite) est
// redimensionnable par une poignée ; largeur bornée pour garder l'édition lisible.
// Desktop seulement (lg+) ; en mobile, l'aperçu passe dessous, pleine largeur.
import { useCallback, useEffect, useRef, useState } from 'react'

const MIN = 360 // px — en-dessous l'aperçu PDF devient illisible
const MAX = 900 // px — au-delà l'édition est trop écrasée
const DEFAULT = 384 // 24rem (largeur historique)
const KEEP_LEFT = 420 // px réservés au minimum à la colonne d'édition
const STORAGE_KEY = 'pv-preview-width'

export function PvResizable({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT)
  const dragging = useRef(false)

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

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    // Largeur de l'aperçu = distance du curseur au bord droit du conteneur.
    setWidth(clamp(rect.right - e.clientX))
  }, [clamp])

  const stop = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    setWidth((w) => { localStorage.setItem(STORAGE_KEY, String(w)); return w })
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stop)
    }
  }, [onPointerMove, stop])

  function onPointerDown() {
    dragging.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  return (
    <div ref={containerRef} className="flex flex-col lg:flex-row lg:items-start lg:gap-0">
      <div className="min-w-0 space-y-6 lg:flex-1">{left}</div>

      {/* Poignée de glissement (desktop) */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Glisser pour redimensionner l'aperçu"
        onPointerDown={onPointerDown}
        onDoubleClick={() => { setWidth(DEFAULT); localStorage.setItem(STORAGE_KEY, String(DEFAULT)) }}
        className="group mx-2 hidden shrink-0 cursor-col-resize items-center self-stretch lg:flex"
      >
        <div className="h-16 w-1.5 rounded-full bg-border transition-colors group-hover:bg-primary/60" />
      </div>

      {/* Aperçu : largeur pilotée (desktop) ; pleine largeur forcée en mobile. */}
      <aside
        style={{ width }}
        className="mt-6 max-lg:!w-full lg:mt-0 lg:shrink-0 lg:sticky lg:top-4"
      >
        {right}
      </aside>
    </div>
  )
}
