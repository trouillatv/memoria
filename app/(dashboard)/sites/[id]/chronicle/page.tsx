import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, BookText, Map as MapIcon } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteChronicle } from '@/lib/db/site-chronicle'
import { listGeolocatedCapturesBySite } from '@/lib/db/visit-captures'
import { CaptureMap, type MapCapture } from '@/components/CaptureMap'
import { SiteChronicleView } from './SiteChronicleView'

export const dynamic = 'force-dynamic'

export default async function SiteChroniclePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, events, geoCaps] = await Promise.all([
    getSiteIdentity(id),
    getSiteChronicle(id),
    listGeolocatedCapturesBySite(id).catch(() => []),
  ])
  if (!identity) notFound()
  const mapCaps: MapCapture[] = geoCaps.map((c) => ({
    id: c.id, kind: c.kind, lat: c.lat, lng: c.lng, created_at: c.created_at,
    body: c.body, reportId: c.report_id, subjectName: c.subject_name,
  }))

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <Link href={`/sites/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>

      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold"><BookText className="h-5 w-5" /> Journal du chantier</h1>
        <p className="text-sm text-muted-foreground">
          L’histoire du chantier au fil des jours — chaque journée résumée, ce qui l’a fait évoluer (réunions, décisions, réserves) en premier.
        </p>
      </header>

      {mapCaps.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <MapIcon className="h-4 w-4" /> Carte des observations
          </h2>
          <CaptureMap siteId={id} captures={mapCaps} heightClass="h-[420px]" />
        </section>
      )}

      <SiteChronicleView siteId={id} events={events} />
    </div>
  )
}
