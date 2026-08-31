import { notFound } from 'next/navigation'
import { requireSiteAccess } from '@/lib/field/site-access'
import { getSiteActionFiche } from '@/lib/knowledge/action-fiche'
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
  const action = await getSiteActionFiche(siteId, actionId).catch(() => null)
  if (!action) notFound()

  // Retour contrôlé. `from=actions` (seul jeton accepté, injecté par la liste
  // scopée /m/actions?site=X) ramène la flèche à cette liste filtrée ; sinon
  // fallback historique = accueil chantier. Jamais de returnTo URL arbitraire :
  // la destination est reconstruite depuis `siteId` du chemin, pas depuis l'URL.
  const backHref = from === 'actions' ? `/m/actions?site=${siteId}` : `/m/site/${siteId}`

  return <MobileActionView action={action} siteId={siteId} backHref={backHref} />
}
