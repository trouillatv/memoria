'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { SitePhotoEntry } from '@/lib/db/site-cockpit'

const FR_MONTHS_SHORT = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays < 1 && d.getDate() === now.getDate()) return "aujourd'hui"
  if (diffDays === 1 || (diffDays < 2 && d.getDate() !== now.getDate())) return 'hier'
  return `${d.getDate()} ${FR_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear() !== now.getFullYear() ? d.getFullYear() : ''}`
    .trim()
}

interface Props {
  photos: SitePhotoEntry[]
}

export function SitePhotoGallery({ photos }: Props) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  const close = useCallback(() => setOpen(false), [])
  const prev = useCallback(() => setIndex((i) => (i - 1 + photos.length) % photos.length), [photos.length])
  const next = useCallback(() => setIndex((i) => (i + 1) % photos.length), [photos.length])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, prev, next, close])

  if (photos.length === 0) return null

  const current = photos[index]

  return (
    <>
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-1">
          {photos.slice(0, 4).map((p, i) => (
            <button
              key={p.id}
              onClick={() => { setIndex(i); setOpen(true) }}
              className="block overflow-hidden rounded border bg-muted aspect-square focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
            >
              <img
                src={p.signedUrl}
                alt={p.caption ?? ''}
                className="h-full w-full object-cover hover:opacity-80 transition-opacity"
              />
            </button>
          ))}
        </div>
        {photos.length > 4 && (
          <button
            onClick={() => { setIndex(4); setOpen(true) }}
            className="text-[10px] text-muted-foreground hover:underline"
          >
            Voir les {photos.length} photos →
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
          onClick={close}
        >
          {/* Close */}
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={close}
            aria-label="Fermer"
          >
            <X className="h-6 w-6" />
          </button>

          {/* Nav prev */}
          {photos.length > 1 && (
            <button
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2"
              onClick={(e) => { e.stopPropagation(); prev() }}
              aria-label="Photo précédente"
            >
              <ChevronLeft className="h-8 w-8" />
            </button>
          )}

          {/* Photo */}
          <div
            className="flex flex-col items-center gap-4 max-w-3xl w-full px-16"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={current.signedUrl}
              alt={current.caption ?? ''}
              className="max-h-[70vh] max-w-full rounded-md object-contain"
            />

            {/* Metadata */}
            <div className="text-center space-y-1 text-sm text-white/80">
              <div className="flex items-center justify-center gap-3 flex-wrap text-[13px]">
                {current.takenByName && (
                  <span><span className="text-white/50 text-xs">qui</span> {current.takenByName}</span>
                )}
                <span><span className="text-white/50 text-xs">quand</span> {formatDate(current.takenAt)}</span>
                {current.locationHint && (
                  <span><span className="text-white/50 text-xs">où</span> {current.locationHint}</span>
                )}
              </div>
              {current.caption && (
                <p className="text-white/60 text-xs max-w-lg leading-snug">{current.caption}</p>
              )}
            </div>

            {/* Dots */}
            {photos.length > 1 && (
              <div className="flex gap-1.5">
                {photos.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setIndex(i)}
                    className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/30'}`}
                    aria-label={`Photo ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Nav next */}
          {photos.length > 1 && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2"
              onClick={(e) => { e.stopPropagation(); next() }}
              aria-label="Photo suivante"
            >
              <ChevronRight className="h-8 w-8" />
            </button>
          )}
        </div>
      )}
    </>
  )
}
