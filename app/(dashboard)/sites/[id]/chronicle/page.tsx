import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, BookText } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteChronicle } from '@/lib/db/site-chronicle'
import { SiteChronicleView } from './SiteChronicleView'

export const dynamic = 'force-dynamic'

export default async function SiteChroniclePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, events] = await Promise.all([getSiteIdentity(id), getSiteChronicle(id)])
  if (!identity) notFound()

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <Link href={`/sites/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>

      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold"><BookText className="h-5 w-5" /> Journal du chantier</h1>
        <p className="text-sm text-muted-foreground">
          Toute l’histoire du chantier — réunions, interventions, décisions, réserves, documents, photos, enrichissements — en une seule chronologie.
        </p>
      </header>

      <SiteChronicleView siteId={id} events={events} />
    </div>
  )
}
