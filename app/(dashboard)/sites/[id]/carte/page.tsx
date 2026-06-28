import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Map as MapIcon } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listVisitCapturesBySite } from '@/lib/db/visit-captures'
import { SiteCaptureMap, type MapCapture } from './SiteCaptureMap'

export const dynamic = 'force-dynamic'

// Carte V0 des captures géolocalisées — « où les observations ont été faites ? ».
// N'affiche QUE les captures avec lat/lng (géoloc opt-in au panier). Prototype URL.

const LEGEND: Array<{ kind: string; label: string; color: string }> = [
  { kind: 'photo', label: 'Photo', color: '#0284c7' },
  { kind: 'video', label: 'Vidéo', color: '#7c3aed' },
  { kind: 'vocal', label: 'Vocal', color: '#d97706' },
  { kind: 'note', label: 'Note', color: '#475569' },
  { kind: 'verification', label: 'Vérification', color: '#059669' },
  { kind: 'position', label: 'Position', color: '#6b7280' },
]

export default async function SiteCartePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const identity = await getSiteIdentity(id)
  if (!identity) notFound()

  const caps = await listVisitCapturesBySite(id, 1000).catch(() => [])
  const geo: MapCapture[] = caps
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({
      id: c.id, kind: c.kind, lat: c.lat as number, lng: c.lng as number,
      created_at: c.created_at, body: c.body, reportId: c.report_id,
    }))

  return (
    <div className="max-w-4xl space-y-4 py-6">
      <Link href={`/sites/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>
      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold"><MapIcon className="h-5 w-5" /> Carte des captures</h1>
        <p className="text-sm text-muted-foreground">Où les observations ont été faites pendant les visites. {geo.length} capture{geo.length > 1 ? 's' : ''} géolocalisée{geo.length > 1 ? 's' : ''}.</p>
      </header>

      {geo.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          Aucune capture géolocalisée. Activez « Géolocaliser les captures » dans le panier d&apos;une visite,
          puis capturez photos / vidéos / notes / vocaux : ils apparaîtront ici.
        </p>
      ) : (
        <>
          <SiteCaptureMap siteId={id} captures={geo} />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {LEGEND.map((l) => (
              <span key={l.kind} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
                {l.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
