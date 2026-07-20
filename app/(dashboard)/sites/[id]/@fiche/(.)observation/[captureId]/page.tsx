import { notFound } from 'next/navigation'
import { getSiteObservationFiche } from '@/lib/knowledge/observation-fiche'
import { ObservationFichePanel } from '../../../views/observation/ObservationFichePanel'

export const dynamic = 'force-dynamic'

// Route INTERCEPTÉE : /sites/<id>/observation/<captureId> s'affiche en panneau
// par-dessus l'onglet courant, qui reste monté.
export default async function ObservationFicheInterceptee({
  params,
}: {
  params: Promise<{ id: string; captureId: string }>
}) {
  const { id, captureId } = await params
  const observation = await getSiteObservationFiche(id, captureId).catch(() => null)
  if (!observation) notFound()
  return <ObservationFichePanel observation={observation} />
}
