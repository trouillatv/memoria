import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getActionsDashboard } from '@/lib/knowledge/actions-dashboard'
import { getSiteActionFiche } from '@/lib/knowledge/action-fiche'
import { todayLocalIso } from '@/lib/time/local-date'
import { ActionsDashboard } from './ActionsDashboard'
import { PersistentFicheSheet } from '@/app/(dashboard)/sites/[id]/views/PersistentFicheSheet'

export const dynamic = 'force-dynamic'

// Pilotage des engagements du chantier (Tranche 1). Read model unique
// getActionsDashboard : 5 KPIs réels, liste enrichie, filtres.
//
// Lot 2 · PR1 (suite) : la LISTE ACTIONS est un contexte de navigation, au même
// titre que le Chantier. Cliquer une action ouvre sa fiche EN SURIMPRESSION ici
// (`/actions?action=<id>&action_site=<siteId>`) via la MÊME coquille persistante —
// sans changer de page. Le chantier ne devient le fond que sur un clic explicite
// (📍 / « Voir le chantier »). « Une vue est remplaçable, l'objet est pérenne. »
export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; action_site?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const { action: actionId, action_site: actionSite } = await searchParams
  const data = await getActionsDashboard()

  // Fail-closed : getSiteActionFiche vérifie que l'action appartient bien au site.
  const actionFiche = actionId && actionSite
    ? await getSiteActionFiche(actionSite, actionId).catch(() => null)
    : null

  return (
    <div className="p-6">
      <ActionsDashboard data={data} today={todayLocalIso()} />
      {/* La coquille reste montée : d'une action à l'autre le contenu change sans
          re-créer le Sheet, exactement comme sur le chantier. */}
      <PersistentFicheSheet siteId={actionSite ?? ''} person={null} action={actionFiche} decision={null} />
    </div>
  )
}
