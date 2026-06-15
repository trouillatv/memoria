import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ClipboardCheck, MapPin } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteReserves, summarizeReserves } from '@/lib/db/site-reserve'
import { getSignedPhotoUrl } from '@/lib/storage/intervention-photos'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { ReserveForm } from './ReserveForm'
import { ReservesView, type ReserveWithPhotos } from './ReservesView'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SiteReservesPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  // Les réserves sont pilotées côté superviseur (réception MOE), pas le terrain.
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, reserves] = await Promise.all([
    getSiteIdentity(id),
    getSiteReserves(id),
  ])

  if (!identity) notFound()

  const summary = summarizeReserves(reserves)

  // Résolution des URLs signées des photos avant/après côté serveur.
  // Bucket 'intervention-photos' (cf. server actions reserves).
  const withPhotos: ReserveWithPhotos[] = await Promise.all(
    reserves.map(async (r) => ({
      ...r,
      photoBeforeUrl: r.photoBeforePath ? await getSignedPhotoUrl(r.photoBeforePath) : null,
      photoAfterUrl: r.photoAfterPath ? await getSignedPhotoUrl(r.photoAfterPath) : null,
    })),
  )

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId="reserves" label="Réserves" />
      <BreadcrumbPrefix crumbs={[
        { href: '/sites', label: 'Sites' },
        { href: `/sites/${id}`, label: identity.name },
      ]} />

      <Link
        href={`/sites/${id}`}
        className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
      >
        ← {identity.name}
      </Link>

      <header className="space-y-1">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
            Réserves
          </h1>
          {/* Compteurs sobres — calme, jamais rouge. Amber pour les ouvertes. */}
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-900 tabular-nums">
              {summary.open} ouverte{summary.open > 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-900 tabular-nums">
              {summary.lifted} levée{summary.lifted > 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {identity.name}
          {identity.clientName ? ` · ${identity.clientName}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          Défauts dressés à la réception (OPR) par la maîtrise d&apos;œuvre, à lever un à un — avec preuve photo et date de levée.
        </p>
      </header>

      <ReserveForm siteId={id} />

      <ReservesView siteId={id} reserves={withPhotos} />
    </div>
  )
}
