import { notFound } from 'next/navigation'
import { requireSiteAccess } from '@/lib/field/site-access'
import { getTrackedPointDetail } from '@/lib/knowledge/tracked-point-detail'
import { PointFicheView } from '@/components/knowledge/PointFicheView'

export const dynamic = 'force-dynamic'

// Retour → le Sujet propriétaire (doctrine nav : précédent = revenir à l'objet).
export default async function MobilePointFichePage({
  params,
}: {
  params: Promise<{ siteId: string; pointId: string }>
}) {
  const { siteId, pointId } = await params
  await requireSiteAccess(siteId)
  const point = await getTrackedPointDetail(siteId, pointId).catch(() => null)
  if (!point) notFound()

  const backHref = point.ownerCanonicalSubjectId
    ? `/m/site/${siteId}/sujets/${point.ownerCanonicalSubjectId}`
    : `/m/site/${siteId}`
  const backLabel = point.ownerCanonicalSubjectLabel
    ? `Retour au sujet « ${point.ownerCanonicalSubjectLabel} »`
    : 'Retour au chantier'

  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-3.5 px-4 pb-16 pt-5">
      <PointFicheView point={point} backHref={backHref} backLabel={backLabel} />
    </div>
  )
}
