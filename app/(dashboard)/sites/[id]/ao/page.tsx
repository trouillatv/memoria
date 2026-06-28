import { redirect } from 'next/navigation'
import { getOpenDossierIdForSite } from '@/lib/db/dossiers'

export const dynamic = 'force-dynamic'

// Compat : l'identité de la lecture AO est désormais le DOSSIER (mig 172), pas le
// site. On redirige l'ancienne URL site-keyée vers le dossier d'opération ouvert
// du lieu, ou vers la liste des opportunités s'il n'y en a pas.
export default async function SiteAoRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dossierId = await getOpenDossierIdForSite(id).catch(() => null)
  redirect(dossierId ? `/dossiers/${dossierId}` : '/opportunites')
}
