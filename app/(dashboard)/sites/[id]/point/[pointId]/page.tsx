import { notFound, redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getTrackedPointDetail } from '@/lib/knowledge/tracked-point-detail'
import { loadMemoriaNeedsYouSummary, filterMemoriaNeedsYouQuestionsForPoint } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { listSiteActionResponsibleCandidates } from '@/lib/knowledge/action-responsible-candidates'
import { listSiteCandidateCompanies } from '@/lib/db/site-intervenants'
import { loadSubjectPointMiniContext } from '@/lib/knowledge/tracked-point-subject-context'
import { PointFicheView } from '@/components/knowledge/PointFicheView'

export const dynamic = 'force-dynamic'

// Accès DIRECT à /sites/<id>/point/<id> : lien partagé, favori, rechargement.
// Retour → le Sujet propriétaire (doctrine nav : précédent = revenir à l'objet).
export default async function PointFichePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; pointId: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, pointId } = await params
  const { from } = await searchParams
  const [identity, point, needsYouSummary, responsibleCandidates, companies] = await Promise.all([
    getSiteIdentity(id),
    getTrackedPointDetail(id, pointId, `/sites/${id}/actions`).catch(() => null),
    loadMemoriaNeedsYouSummary(id).catch(() => null),
    listSiteActionResponsibleCandidates(id).catch(() => []),
    listSiteCandidateCompanies(id).catch(() => []),
  ])
  if (!identity || !point) notFound()

  const subjectMiniContext = await loadSubjectPointMiniContext(id, point.ownerCanonicalSubjectId, point.id).catch(() => null)

  // Retour au Delta chantier si on en vient (recette Vincent 2026-09-14) : préserve le
  // contexte de David dans sa revue plutôt que de le renvoyer systématiquement au sujet.
  const backHref = from === 'delta'
    ? `/sites/${id}/points?tab=delta`
    : point.ownerCanonicalSubjectId
      ? `/sites/${id}/historique/sujets/${point.ownerCanonicalSubjectId}`
      : `/sites/${id}?tab=memoire`
  const backLabel = from === 'delta'
    ? 'Retour au Delta chantier'
    : point.ownerCanonicalSubjectLabel
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
        subjectMiniContext={subjectMiniContext}
        subjectHref={point.ownerCanonicalSubjectId ? `/sites/${id}/historique/sujets/${point.ownerCanonicalSubjectId}` : undefined}
      />
    </div>
  )
}
