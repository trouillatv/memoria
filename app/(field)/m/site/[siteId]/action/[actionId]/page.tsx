import { notFound } from 'next/navigation'
import { requireSiteAccess } from '@/lib/field/site-access'
import { getSiteActionFiche } from '@/lib/knowledge/action-fiche'
import { listSiteActionResponsibleCandidates } from '@/lib/knowledge/action-responsible-candidates'
import { listSiteCandidateCompanies } from '@/lib/db/site-intervenants'
import { MobileActionView } from './MobileActionView'

export const dynamic = 'force-dynamic'

export default async function MobileActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string; actionId: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { siteId, actionId } = await params
  // Garde d'appartenance (doctrine : chaque page de chantier), en plus du contrôle
  // d'org interne à getSiteActionFiche.
  await requireSiteAccess(siteId)
  const { from } = await searchParams
  const [action, responsibleCandidates, companies] = await Promise.all([
    getSiteActionFiche(siteId, actionId).catch(() => null),
    // P0-4M — même panneau d'affectation partagé que Point/Vue Actions/Fiche desktop.
    listSiteActionResponsibleCandidates(siteId).catch(() => []),
    listSiteCandidateCompanies(siteId).catch(() => []),
  ])
  if (!action) notFound()

  // Retour contrôlé. `from=actions` (seul jeton accepté, injecté par la liste
  // scopée /m/actions?site=X) ramène la flèche à cette liste filtrée ; sinon
  // fallback historique = accueil chantier. Jamais de returnTo URL arbitraire :
  // la destination est reconstruite depuis `siteId` du chemin, pas depuis l'URL.
  const backHref = from === 'actions' ? `/m/actions?site=${siteId}` : `/m/site/${siteId}`

  return (
    <MobileActionView
      action={action}
      siteId={siteId}
      backHref={backHref}
      responsibleCandidates={responsibleCandidates}
      companies={companies}
    />
  )
}
