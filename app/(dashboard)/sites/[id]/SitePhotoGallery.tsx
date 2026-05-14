import Link from 'next/link'
import type { SitePhotoEntry } from '@/lib/db/site-cockpit'

interface Props {
  photos: SitePhotoEntry[]
  siteId: string
}

export function SitePhotoGallery({ photos, siteId }: Props) {
  if (photos.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1">
        {photos.map((p) => (
          <Link
            key={p.id}
            href={`/sites/${siteId}/photos`}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded border bg-muted aspect-square"
          >
            <img
              src={p.signedUrl}
              alt={p.caption ?? ''}
              className="h-full w-full object-cover hover:opacity-80 transition-opacity"
            />
          </Link>
        ))}
      </div>
      <Link
        href={`/sites/${siteId}/photos`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-muted-foreground hover:underline"
      >
        Voir toutes les photos →
      </Link>
    </div>
  )
}
