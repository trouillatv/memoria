'use client'

// Lot correctif Terrain (Vincent, 2026-08-26) : remplace le popup Leaflet
// volumineux d'un cluster par un écran plein écran — même famille visuelle que
// PhotoGallery (app/(field)/m/site/[siteId]/photos/PhotoGallery.tsx), tap sur
// une preuve → sa fiche observation, aucune dépendance au fond Plan/Satellite.

import Link from 'next/link'
import { X, Video, Mic, Pencil, HelpCircle } from 'lucide-react'
import { KIND_LABEL, type MapCapture } from '@/components/CaptureMap'

const KIND_ICON: Record<string, typeof Video> = {
  video: Video, vocal: Mic, note: Pencil, verification: HelpCircle,
}

export function CaptureClusterGallery({ captures, onClose }: {
  captures: MapCapture[]
  onClose: () => void
}) {
  const sorted = [...captures].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-[14px] font-medium text-white">
          {captures.length} preuve{captures.length > 1 ? 's' : ''} à cet endroit
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="rounded-full p-1.5 text-white/80 active:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="grid grid-cols-2 gap-2.5">
          {sorted.map((c) => {
            const date = new Date(c.created_at).toLocaleString('fr-FR', {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            })
            const Icon = KIND_ICON[c.kind]
            return (
              <Link
                key={c.id}
                href={`/m/observation/${c.id}?from=terrain`}
                className="overflow-hidden rounded-xl border border-white/10 bg-white/5 active:bg-white/10"
              >
                <div className="relative aspect-[4/3] w-full bg-white/10">
                  {c.kind === 'photo' && c.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      {Icon ? <Icon className="h-6 w-6 text-white/50" /> : null}
                    </div>
                  )}
                </div>
                <div className="space-y-0.5 px-2.5 py-2">
                  <p className="text-[11px] font-medium text-white/90">
                    {KIND_LABEL[c.kind] ?? c.kind} · {date}
                  </p>
                  {c.body?.trim() && (
                    <p className="truncate text-[11px] text-white/60">{c.body.trim()}</p>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
