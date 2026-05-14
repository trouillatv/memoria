import Link from 'next/link'
import type { SitePhotoEntry } from '@/lib/db/site-cockpit'

export function SitePhotoGallery({ photos }: { photos: SitePhotoEntry[] }) {
  if (photos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Pas de photo déposée sur ce site.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {photos.map((p) => (
        <Link
          key={p.id}
          href={`/interventions/${p.interventionId}`}
          className="group block overflow-hidden rounded-md border bg-muted"
          aria-label={p.caption ?? "Voir l'intervention"}
        >
          <div className="aspect-square relative overflow-hidden">
            <img
              src={p.signedUrl}
              alt={p.caption ?? ''}
              className="absolute inset-0 h-full w-full object-cover transition-opacity group-hover:opacity-80"
            />
          </div>
          {p.caption && (
            <p className="px-1.5 py-1 text-[10px] leading-snug text-muted-foreground truncate">
              {p.caption}
            </p>
          )}
        </Link>
      ))}
    </div>
  )
}
