import { notFound } from 'next/navigation'
import { getSiteReunionFiche } from '@/lib/knowledge/reunion-fiche'
import { ReunionFichePanel } from '../../../views/reunion/ReunionFichePanel'

export const dynamic = 'force-dynamic'

// Route INTERCEPTÉE : atteinte depuis l'application, /sites/<id>/reunion/<id>
// s'affiche en PANNEAU par-dessus l'onglet courant, qui reste monté. La même
// adresse ouverte directement rend une page complète — une adresse, deux rendus,
// un seul composant de corps.
export default async function ReunionFicheInterceptee({
  params,
}: {
  params: Promise<{ id: string; reportId: string }>
}) {
  const { id, reportId } = await params
  const reunion = await getSiteReunionFiche(id, reportId).catch(() => null)
  if (!reunion) notFound()
  return <ReunionFichePanel reunion={reunion} />
}
