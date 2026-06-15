'use client'

// Galerie thumbnails — photos prises par l'intervenant. Inspiré de
// SitePhotoGallery (page /sites/[id]) — même UX lightbox avec navigation
// clavier (← / → / Esc).

import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { IntervenantPhotoEntry } from '@/lib/db/intervenants'

const FR_MONTHS_SHORT = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays < 1 && d.getDate() === now.getDate()) return "aujourd'hui"
  if (diffDays === 1 || (diffDays < 2 && d.getDate() !== now.getDate())) return 'hier'
  const year = d.getFullYear() !== now.getFullYear() ? d.getFullYear() : ''
  return `${d.getDate()} ${FR_MONTHS_SHORT[d.getMonth()]} ${year}`.trim()
}

interface Props {
  photos: IntervenantPhotoEntry[]
}

export function IntervenantPhotoGallery({ photos }: Props) {
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
        <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(72px,1fr))]">
          {photos.slice(0, 4).map((p, i) => (
            <button
              key={p.id}
              onClick={() => {
                setIndex(i)
                setOpen(true)
              }}
              className="block overflow-hidden rounded border bg-muted aspect-square focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
              title={p.siteName ? `${p.siteName} · ${formatDate(p.takenAt)}` : formatDate(p.takenAt)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
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
            type="button"
            onClick={() => { setIndex(4); setOpen(true) }}
            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            +{photos.length - 4} autre{photos.length - 4 > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {open && current && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
          onClick={close}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={close}
            aria-label="Fermer"
          >
            <X className="h-6 w-6" />
          </button>

          {photos.length > 1 && (
            <button
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2"
              onClick={(e) => {
                e.stopPropagation()
                prev()
              }}
              aria-label="Photo précédente"
            >
              <ChevronLeft className="h-8 w-8" />
            </button>
          )}

          <div
            className="flex flex-col items-center gap-4 max-w-3xl w-full px-16"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.signedUrl}
              alt={current.caption ?? ''}
              className="max-h-[70vh] max-w-full rounded-md object-contain"
            />
            <div className="text-center space-y-1 text-sm text-white/80">
              <div className="flex items-center justify-center gap-3 flex-wrap text-[13px]">
                {current.siteName && (
                  <span>
                    <span className="text-white/50 text-xs">où</span> {current.siteName}
                  </span>
                )}
                <span>
                  <span className="text-white/50 text-xs">quand</span> {formatDate(current.takenAt)}
                </span>
              </div>
              {current.caption && (
                <p className="text-white/60 text-xs max-w-lg leading-snug">
                  {current.caption}
                </p>
              )}
            </div>
            {photos.length > 1 && (
              <div className="flex gap-1.5">
                {photos.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setIndex(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/30'
                    }`}
                    aria-label={`Photo ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>

          {photos.length > 1 && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2"
              onClick={(e) => {
                e.stopPropagation()
                next()
              }}
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
