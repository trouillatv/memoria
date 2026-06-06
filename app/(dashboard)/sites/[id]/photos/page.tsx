import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getSiteIdentity, getSiteRecentPhotos } from '@/lib/db/site-cockpit'

interface PageProps {
  params: Promise<{ id: string }>
}

export const dynamic = 'force-dynamic'

export default async function SitePhotosPage({ params }: PageProps) {
  const { id } = await params
  const [identity, photos] = await Promise.all([
    getSiteIdentity(id),
    getSiteRecentPhotos(id, 50),
  ])
  if (!identity) notFound()

  return (
    <div className="w-full px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/sites/${id}`}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← {identity.name}
        </Link>
        <span className="text-xs text-muted-foreground">
          {photos.length} photo{photos.length > 1 ? 's' : ''}
        </span>
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Pas de photo déposée sur ce site.
        </p>
      ) : (
        <div className="columns-1 sm:columns-2 gap-4 space-y-4">
          {photos.map((p) => (
            <div key={p.id} className="break-inside-avoid space-y-1.5">
              <img
                src={p.signedUrl}
                alt={p.caption ?? ''}
                className="w-full rounded-md border bg-muted block"
              />
              {p.caption && (
                <p className="text-xs text-muted-foreground leading-snug px-0.5">
                  {p.caption}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
