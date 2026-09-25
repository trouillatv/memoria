import { requireDeskUser } from '@/lib/auth/page-guard'
import { notFound } from 'next/navigation'
import { getSiteActionFiche } from '@/lib/knowledge/action-fiche'
import { listSiteActionResponsibleCandidates } from '@/lib/knowledge/action-responsible-candidates'
import { listSiteCandidateCompanies } from '@/lib/db/site-intervenants'
import { listCandidateEngagementsForActionAction, listEngagementLinksForActionAction } from '@/app/(dashboard)/actions/actions'
import { ActionFichePanel } from '../../../views/action/ActionFichePanel'

export const dynamic = 'force-dynamic'

// Route INTERCEPTÉE — second maillon du prototype. Atteinte depuis une fiche
// Décision, l'adresse /sites/<id>/action/<id> s'affiche en panneau par-dessus
// l'onglet, qui reste monté. La chaîne Décision → Action existe donc enfin.
export default async function ActionFicheInterceptee({
  params,
}: {
  params: Promise<{ id: string; actionId: string }>
}) {
  // Une route INTERCEPTÉE est une page : elle s atteint aussi en tapant l URL.
  // Le panneau ne doit pas etre une porte plus large que la page directe.
  await requireDeskUser()

  const { id, actionId } = await params
  const [action, responsibleCandidates, companies, engagementCandidates, engagementLinks] = await Promise.all([
    getSiteActionFiche(id, actionId, { withSubjectContext: true }).catch(() => null),
    // Lot normalisation 3 points d'entrée (Vincent 2026-09-15) — même panneau
    // d'affectation partagé que Point/Vue Actions.
    listSiteActionResponsibleCandidates(id).catch(() => []),
    listSiteCandidateCompanies(id).catch(() => []),
    // P0-4B — Engagement de référence (managerOrAdmin, cf. server actions).
    listCandidateEngagementsForActionAction(id).catch(() => []),
    listEngagementLinksForActionAction(actionId).catch(() => []),
  ])
  if (!action) notFound()
  return (
    <ActionFichePanel
      action={action}
      responsibleCandidates={responsibleCandidates}
      companies={companies}
      engagementCandidates={engagementCandidates}
      engagementLinks={engagementLinks}
    />
  )
}
