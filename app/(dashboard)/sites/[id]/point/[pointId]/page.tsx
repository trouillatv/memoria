import { notFound, redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getTrackedPointDetail } from '@/lib/knowledge/tracked-point-detail'
import { loadMemoriaNeedsYouSummary, filterMemoriaNeedsYouQuestionsForPoint } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { listSiteActionResponsibleCandidates } from '@/lib/knowledge/action-responsible-candidates'
import { listSiteCandidateCompanies } from '@/lib/db/site-intervenants'
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
  const [identity, point, needsYouSummary, responsibleCandidates, companies] = await Promise.all([
    getSiteIdentity(id),
    getTrackedPointDetail(id, pointId, `/sites/${id}/actions`).catch(() => null),
    loadMemoriaNeedsYouSummary(id).catch(() => null),
    listSiteActionResponsibleCandidates(id).catch(() => []),
    listSiteCandidateCompanies(id).catch(() => []),
  ])
  if (!identity || !point) notFound()

  const backHref = point.ownerCanonicalSubjectId
    ? `/sites/${id}/historique/sujets/${point.ownerCanonicalSubjectId}`
    : `/sites/${id}?tab=memoire`
  const backLabel = point.ownerCanonicalSubjectLabel
    ? `Retour au sujet « ${point.ownerCanonicalSubjectLabel} »`
    : identity.name

  // Le canonique affiché (point.id) peut différer du pointId demandé (fusion) — la file
  // NeedsYou doit référencer le Point réellement montré, jamais celui de l'URL.
  const needsYouQuestions = needsYouSummary
    ? filterMemoriaNeedsYouQuestionsForPoint(needsYouSummary.questions, point.id)
    : []

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-1 py-6">
      <PointFicheView
        point={point}
        backHref={backHref}
        backLabel={backLabel}
        needsYouQuestions={needsYouQuestions}
        needsYouHref={`/sites/${id}/besoin-de-toi`}
        responsibleCandidates={responsibleCandidates}
        companies={companies}
      />
    </div>
  )
}
