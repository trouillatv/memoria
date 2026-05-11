// Slice B.1 — Grid de thumbnails + modal simple au click.
//
// Doctrine : aperçu rapide, full-size au click. La vraie lightbox (navigation
// prev/next, captions visibles, swipe mobile) arrive en B.2.
// Pour cette slice : un overlay propre qui ferme à l'Escape ou au click outside.

'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { ProofPhoto } from '@/lib/db/proofs'

export function ProofPhotoGrid({ photos }: { photos: ProofPhoto[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const openPhoto = photos.find((p) => p.id === openId) ?? null

  // Escape pour fermer.
  useEffect(() => {
    if (!openId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId])

  if (photos.length === 0) return null

  return (
    <>
      <div
        role="list"
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
      >
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            role="listitem"
            onClick={() => setOpenId(p.id)}
            className="relative aspect-square rounded-md overflow-hidden border bg-muted hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label={p.caption ?? 'Voir la photo'}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.thumbnail_url ?? p.url}
              alt={p.caption ?? 'Photo intervention'}
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
          aria-label="Photo plein écran"
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setOpenId(null)}
        >
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="absolute top-3 right-3 rounded-full bg-white/10 hover:bg-white/20 text-white p-2"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={openPhoto.url}
            alt={openPhoto.caption ?? 'Photo intervention'}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
