'use client'

import Link from 'next/link'
import { X } from 'lucide-react'
import { useState } from 'react'

export type PhotoItem = {
  id: string
  url: string
  body: string | null
}

export type PhotoGroup = {
  reportId: string
  dateLabel: string
  visitHref: string
  photos: PhotoItem[]
}

type Lightbox = {
  url: string
  body: string | null
  dateLabel: string
  visitHref: string
}

export function PhotoGallery({ groups }: { groups: PhotoGroup[] }) {
  const [lightbox, setLightbox] = useState<Lightbox | null>(null)

  return (
    <>
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.reportId}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-muted-foreground first-letter:uppercase">
                {g.dateLabel}
              </h2>
              <Link
                href={g.visitHref}
                className="text-[12px] text-muted-foreground underline-offset-2 active:underline"
              >
                Voir la visite
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {g.photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setLightbox({ url: p.url, body: p.body, dateLabel: g.dateLabel, visitHref: g.visitHref })
                  }
                  className="aspect-square overflow-hidden rounded-lg bg-muted active:opacity-80"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.body ?? ''}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black"
          onClick={() => setLightbox(null)}
        >
          {/* Bouton fermer */}
          <div className="flex shrink-0 items-center justify-between px-4 py-3">
            <span className="text-[13px] text-white/70 first-letter:uppercase">{lightbox.dateLabel}</span>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="rounded-full p-1 text-white/80 active:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Image centrée */}
          <div className="flex flex-1 items-center justify-center overflow-hidden px-2" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt={lightbox.body ?? ''}
              className="max-h-full max-w-full rounded object-contain"
            />
          </div>

          {/* Bas : note + lien visite */}
          <div className="shrink-0 space-y-2 px-4 py-4" onClick={(e) => e.stopPropagation()}>
            {lightbox.body && (
              <p className="text-sm text-white/80">{lightbox.body}</p>
            )}
            <Link
              href={lightbox.visitHref}
              className="inline-block text-[13px] text-white/60 underline underline-offset-2 active:text-white"
            >
              Ouvrir la visite
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
