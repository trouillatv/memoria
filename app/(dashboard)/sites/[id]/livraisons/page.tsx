import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Truck, MapPin } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteDeliveries, getSignedDeliveryPhotoUrl } from '@/lib/db/site-delivery'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { DeliveryForm } from './DeliveryForm'
import { DeliveriesView, type DeliveryWithPhoto } from './DeliveriesView'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SiteDeliveriesPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, deliveries] = await Promise.all([
    getSiteIdentity(id),
    getSiteDeliveries(id),
  ])

  if (!identity) notFound()

  // Résolution des URLs signées des photos de BL côté serveur.
  const withPhotos: DeliveryWithPhoto[] = await Promise.all(
    deliveries.map(async (d) => ({
      ...d,
      photoUrl: await getSignedDeliveryPhotoUrl(d.photoPath),
    })),
  )

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId="livraisons" label="Bons de livraison" />
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
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Truck className="h-5 w-5 text-muted-foreground" />
          Bons de livraison
        </h1>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {identity.name}
          {identity.clientName ? ` · ${identity.clientName}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          Chaque livraison reçue sur le chantier (béton, matériaux), avec photo du bon — datée et opposable.
        </p>
      </header>

      <DeliveryForm siteId={id} />

      <DeliveriesView deliveries={withPhotos} />
    </div>
  )
}
