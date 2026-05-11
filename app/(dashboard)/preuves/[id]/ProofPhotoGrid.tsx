// Slice B.2 — Grid de thumbnails + vraie lightbox.
//
// Doctrine : aperçu rapide, navigation fluide, accessible.
//   - Click thumbnail → lightbox plein écran avec :
//       * Indicateur "X / Y" en haut
//       * Boutons prev/next (ChevronLeft / ChevronRight) — hidden au début/fin
//       * Caption affichée en bas si présente
//       * Lock body scroll quand ouvert
//   - Touches clavier : ArrowLeft, ArrowRight, Escape
//   - Swipe tactile gauche/droite (touch events natifs, seuil 50px)
//   - Pas de wrap (au bord, on reste sur place)
//
// Pas de zoom/pan ni download : c'est l'export PDF complet (Slice B.3) qui
// porte la valeur "partage".

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ProofPhoto } from '@/lib/db/proofs'

export function ProofPhotoGrid({ photos }: { photos: ProofPhoto[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const close = useCallback(() => setOpenIndex(null), [])
  const next = useCallback(() => {
    setOpenIndex((i) => (i === null ? null : Math.min(photos.length - 1, i + 1)))
  }, [photos.length])
  const prev = useCallback(() => {
    setOpenIndex((i) => (i === null ? null : Math.max(0, i - 1)))
  }, [])

  // Navigation clavier : Escape ferme, ArrowLeft/Right naviguent.
  useEffect(() => {
    if (openIndex === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openIndex, close, next, prev])

  // Lock body scroll quand la lightbox est ouverte.
  useEffect(() => {
    if (openIndex === null) return
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = orig
    }
  }, [openIndex])

  // Swipe tactile (mobile). Seuil 50px pour éviter le déclenchement involontaire.
  const touchStartX = useRef<number | null>(null)
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(delta) > 50) {
      if (delta < 0) next()
      else prev()
    }
    touchStartX.current = null
  }

  if (photos.length === 0) return null

  const openPhoto = openIndex !== null ? photos[openIndex] : null
  const hasPrev = openIndex !== null && openIndex > 0
  const hasNext = openIndex !== null && openIndex < photos.length - 1

  return (
    <>
      <div
        role="list"
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
      >
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="listitem"
            onClick={() => setOpenIndex(i)}
            className="relative aspect-square rounded-md overflow-hidden border bg-muted hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label={p.caption ?? `Voir la photo ${i + 1} sur ${photos.length}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.thumbnail_url ?? p.url}
              alt={p.caption ?? `Photo ${i + 1}`}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
            {p.kind === 'anomaly' && (
              <span className="absolute top-1 left-1 inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100/95 text-amber-900 text-[10px] font-medium border border-amber-200">
                Anomalie
              </span>
            )}
          </button>
        ))}
      </div>

      {openPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Visualisation photo"
          className="fixed inset-0 z-50 bg-black/85 flex flex-col"
          onClick={close}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Top bar : indicateur + bouton fermer */}
          <div
            className="flex items-center justify-between px-4 py-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-medium tabular-nums">
              {(openIndex as number) + 1} / {photos.length}
            </span>
            <button
              type="button"
              onClick={close}
              className="rounded-full bg-white/10 hover:bg-white/20 p-2"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Zone image + boutons nav */}
          <div className="flex-1 flex items-center justify-center px-4 min-h-0 relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={openPhoto.url}
              alt={openPhoto.caption ?? `Photo ${(openIndex as number) + 1}`}
              className="max-h-full max-w-full object-contain select-none"
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            />

            {hasPrev && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  prev()
                }}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 text-white p-3"
                aria-label="Photo précédente"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {hasNext && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  next()
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 text-white p-3"
                aria-label="Photo suivante"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>

          {/* Caption (si présente) */}
          {openPhoto.caption && (
            <div
              className="px-6 py-3 text-white text-sm bg-black/40"
              onClick={(e) => e.stopPropagation()}
            >
              {openPhoto.caption}
            </div>
          )}
        </div>
      )}
    </>
  )
}
