import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listMeetingSitesAction } from '../meeting-actions'
import { ImportVisit } from './ImportVisit'

export const dynamic = 'force-dynamic'

/**
 * Importer une visite (mig 184) — la 2ᵉ porte d'entrée. Le sous-traitant envoie
 * ses photos/vocaux comme d'habitude ; le conducteur dépose ici l'export WhatsApp
 * (ou un lot de fichiers). MemorIA reconstruit la chronologie, découpe en visites
 * et fait entrer DIRECTEMENT dans le tri qu'on utilise en direct. Une seule
 * chaîne, deux portes. Cf. docs/ingestion-engine.md.
 */
export default async function ImportVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; mode?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) return null
  const sites = await listMeetingSitesAction()
  // Présélection depuis « Nouvelle visite → Importer WhatsApp / fichiers ».
  const { site, mode } = await searchParams
  const initialSiteId = site && sites.some((s) => s.id === site) ? site : undefined
  const initialSource = mode === 'upload' ? 'upload' : mode === 'whatsapp_zip' ? 'whatsapp_zip' : undefined

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg px-4 pb-24 pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/m" aria-label="Retour" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-semibold">Importer une visite</h1>
      </div>
      <ImportVisit sites={sites} initialSiteId={initialSiteId} initialSource={initialSource} />
    </div>
  )
}
