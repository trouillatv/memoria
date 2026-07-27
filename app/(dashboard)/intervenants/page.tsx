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
import { getActorsDirectory } from '@/lib/db/actors-directory'
import { ActorsDirectoryView } from './ActorsDirectoryView'

export const dynamic = 'force-dynamic'

export default async function IntervenantsListPage() {
  const access = await checkIntervenantsPageAccess(null)
  if (!access.allowed) {
    if (access.reason === 'unauthenticated') redirect('/login')
    notFound()
  }
  if (!access.access.isPrivileged) notFound()

  const orgIds = await getOrgIdsOfUser()
  const directory = await getActorsDirectory(orgIds)

  return <ActorsDirectoryView directory={directory} />
}
