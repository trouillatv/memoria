import { notFound } from 'next/navigation'
import { requireSiteAccess } from '@/lib/field/site-access'
import { getTrackedPointDetail } from '@/lib/knowledge/tracked-point-detail'
import { loadMemoriaNeedsYouSummary, filterMemoriaNeedsYouQuestionsForPoint } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { listSiteActionResponsibleCandidates } from '@/lib/knowledge/action-responsible-candidates'
import { listSiteCandidateCompanies } from '@/lib/db/site-intervenants'
import { loadSubjectPointMiniContext } from '@/lib/knowledge/tracked-point-subject-context'
import { PointFicheView } from '@/components/knowledge/PointFicheView'

export const dynamic = 'force-dynamic'

// Retour → le Sujet propriétaire (doctrine nav : précédent = revenir à l'objet).
export default async function MobilePointFichePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string; pointId: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { siteId, pointId } = await params
  const { from } = await searchParams
  await requireSiteAccess(siteId)
  const [point, needsYouSummary, responsibleCandidates, companies] = await Promise.all([
    getTrackedPointDetail(siteId, pointId, `/m/site/${siteId}/actions`).catch(() => null),
    loadMemoriaNeedsYouSummary(siteId).catch(() => null),
    listSiteActionResponsibleCandidates(siteId).catch(() => []),
    listSiteCandidateCompanies(siteId).catch(() => []),
  ])
  if (!point) notFound()

  const subjectMiniContext = await loadSubjectPointMiniContext(siteId, point.ownerCanonicalSubjectId, point.id).catch(() => null)

  // Retour au Delta chantier si on en vient (recette Vincent 2026-09-14) : préserve le
  // contexte de David dans sa revue plutôt que de le renvoyer systématiquement au sujet.
  const backHref = from === 'delta'
    ? `/m/site/${siteId}/points?tab=delta`
    : point.ownerCanonicalSubjectId
      ? `/m/site/${siteId}/sujets/${point.ownerCanonicalSubjectId}`
      : `/m/site/${siteId}`
  const backLabel = from === 'delta'
    ? 'Retour au Delta chantier'
    : point.ownerCanonicalSubjectLabel
      ? `Retour au sujet « ${point.ownerCanonicalSubjectLabel} »`
      : 'Retour au chantier'

  const needsYouQuestions = needsYouSummary
    ? filterMemoriaNeedsYouQuestionsForPoint(needsYouSummary.questions, point.id)
    : []

  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-3.5 px-4 pb-16 pt-5">
      <PointFicheView
        point={point}
        backHref={backHref}
        backLabel={backLabel}
        needsYouQuestions={needsYouQuestions}
        needsYouHref={`/m/site/${siteId}/besoin-de-toi`}
        responsibleCandidates={responsibleCandidates}
        companies={companies}
        subjectMiniContext={subjectMiniContext}
        subjectHref={point.ownerCanonicalSubjectId ? `/m/site/${siteId}/sujets/${point.ownerCanonicalSubjectId}` : undefined}
      />
    </div>
  )
}
