// Page Intervenants (Lot 2B.2) — répertoire opérationnel unifié, LECTURE SEULE.
// Surface « cockpit humain » de l'org : agrège person | company | team sans
// jamais fusionner les entités (cf. docs/foundations/2026-07-27-intervenants-
// repertoire-cadrage.md et doctrine des trois surfaces).
//
// Garde-fous techniques inchangés (cf. mémoire page-personne-pivot-transgression) :
//   #5 Kill switch ENV (INTERVENANTS_PAGE_ENABLED) — checkIntervenantsPageAccess
//   Accès manager/admin uniquement (jamais chef_equipe). Desktop only.

import { notFound, redirect } from 'next/navigation'
import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getActorsCockpit } from '@/lib/db/actors-cockpit'
import { getActorsGraph } from '@/lib/knowledge/actors-graph'
import { getCollaborationGraph } from '@/lib/db/collaboration-graph'
import { getUnconfirmedActorProposals } from '@/lib/db/actor-proposals'
import { listTeams } from '@/lib/db/teams'
import { ActorsCockpitView } from './ActorsCockpitView'

export const dynamic = 'force-dynamic'

export default async function IntervenantsListPage({ searchParams }: { searchParams: Promise<{ vue?: string; focus?: string }> }) {
  const access = await checkIntervenantsPageAccess(null)
  if (!access.allowed) {
    if (access.reason === 'unauthenticated') redirect('/login')
    notFound()
  }
  if (!access.access.isPrivileged) notFound()

  const sp = await searchParams
  const showGraph = sp.vue === 'graphe'

  const orgIds = await getOrgIdsOfUser()
  const [directory, teams, proposals] = await Promise.all([
    getActorsCockpit(orgIds),
    listTeams(),
    getUnconfirmedActorProposals(orgIds),
  ])
  // Équipes de l'org pour le rattachement facultatif à la création d'un intervenant.
  const teamOptions = teams.map((t) => ({ id: t.id, name: t.name }))
  // CHARGEMENT PARESSEUX (Vincent) : la liste reste la vue par défaut ; on ne paie le
  // coût des graphes QUE lorsque l'utilisateur bascule sur la vue Graphe (?vue=graphe).
  // Structurel + collaboration pondérée (bascule de source côté client).
  const [graph, collabGraph] = showGraph
    ? await Promise.all([getActorsGraph(orgIds), getCollaborationGraph(orgIds, new Date())])
    : [null, null]

  return (
    <ActorsCockpitView
      directory={directory}
      teams={teamOptions}
      proposals={proposals}
      graph={graph}
      collabGraph={collabGraph}
      focusId={sp.focus ?? null}
      view={showGraph ? 'graph' : 'list'}
    />
  )
}
