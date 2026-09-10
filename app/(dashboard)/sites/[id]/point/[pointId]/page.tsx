import { notFound, redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getTrackedPointDetail } from '@/lib/knowledge/tracked-point-detail'
import { PointFicheView } from '@/components/knowledge/PointFicheView'

export const dynamic = 'force-dynamic'

// Accès DIRECT à /sites/<id>/point/<id> : lien partagé, favori, rechargement.
// Retour → le Sujet propriétaire (doctrine nav : précédent = revenir à l'objet).
export default async function PointFichePage({
  params,
}: {
  params: Promise<{ id: string; pointId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, pointId } = await params
  const [identity, point] = await Promise.all([
    getSiteIdentity(id),
    getTrackedPointDetail(id, pointId).catch(() => null),
  ])
  if (!identity || !point) notFound()

  const backHref = point.ownerCanonicalSubjectId
    ? `/sites/${id}/historique/sujets/${point.ownerCanonicalSubjectId}`
    : `/sites/${id}?tab=memoire`
  const backLabel = point.ownerCanonicalSubjectLabel
    ? `Retour au sujet « ${point.ownerCanonicalSubjectLabel} »`
    : identity.name

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-1 py-6">
      <PointFicheView point={point} backHref={backHref} backLabel={backLabel} />
    </div>
  )
}
