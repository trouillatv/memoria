import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ClipboardCheck, MapPin } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteReserves, summarizeReserves } from '@/lib/db/site-reserve'
import { listSiteActionsByReserve } from '@/lib/db/site-actions'
import { listDocumentsForTarget } from '@/lib/db/documents'
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

  // Mini-dossier par réserve : photos signées + actions correctives + documents
  // liés. Documents du site = source du sélecteur « lier un document ».
  const [withPhotos, siteDocuments] = await Promise.all([
    Promise.all(
      reserves.map(async (r): Promise<ReserveWithPhotos> => {
        const [photoBeforeUrl, photoAfterUrl, actions, documents] = await Promise.all([
          r.photoBeforePath ? getSignedPhotoUrl(r.photoBeforePath) : Promise.resolve(null),
          r.photoAfterPath ? getSignedPhotoUrl(r.photoAfterPath) : Promise.resolve(null),
          listSiteActionsByReserve(r.id).catch(() => []),
          listDocumentsForTarget('reserve', r.id).catch(() => []),
        ])
        return {
          ...r,
          photoBeforeUrl,
          photoAfterUrl,
          actions: actions.map((a) => ({
            id: a.id, title: a.title, assignedTo: a.assigned_to, status: a.status, dueDate: a.due_date,
          })),
          documents: documents.map((d) => ({ id: d.id, filename: d.filename })),
        }
      }),
    ),
    listDocumentsForTarget('site', id).catch(() => []),
  ])
  const sitePickerDocs = siteDocuments.map((d) => ({ id: d.id, filename: d.filename }))

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId="reserves" label="Points à lever" />
      <BreadcrumbPrefix crumbs={[
        { href: '/sites', label: 'Chantiers' },
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
            Points à lever
          </h1>
          {/* Compteurs sobres — calme, jamais rouge. Amber pour les ouverts. */}
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-900 tabular-nums">
              {summary.open} ouvert{summary.open > 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-900 tabular-nums">
              {summary.lifted} levé{summary.lifted > 1 ? 's' : ''}
            </span>
            {reserves.length > 0 && (
              <a
                href={`/sites/${id}/reserves/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium hover:bg-muted/40"
              >
                Exporter PDF
              </a>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {identity.name}
          {identity.clientName ? ` · ${identity.clientName}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          Points à corriger signalés par un tiers (client, contrôleur, maître d&apos;œuvre), à lever un à un — avec preuve photo et date de levée.
        </p>
      </header>

      <ReserveForm siteId={id} />

      <ReservesView siteId={id} reserves={withPhotos} siteDocuments={sitePickerDocs} />
    </div>
  )
}
