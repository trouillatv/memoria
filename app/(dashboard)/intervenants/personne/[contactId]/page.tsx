// Fiche PERSONNE (Lot 2B.3A) — surface de LECTURE d'un contact (company_contacts).
// Le CORPS de la fiche est partagé avec le panneau maître-détail de /intervenants
// (PersonFicheBody) : une seule source de rendu, aucune divergence. Cette page ajoute
// seulement le chrome (garde d'accès + fil d'Ariane). Ordre imposé : Situation →
// Organisation → Travail en cours → Historique. Carte de synthèse : règle des 5 s.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getPersonFiche } from '@/lib/db/person-fiche'
import { getActorNetwork } from '@/lib/knowledge/actors-graph'
import { PersonFicheBody } from '../../PersonFicheBody'

export const dynamic = 'force-dynamic'

export default async function PersonFichePage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params
  const access = await checkIntervenantsPageAccess(null)
  if (!access.allowed) {
    if (access.reason === 'unauthenticated') redirect('/login')
    notFound()
  }
  if (!access.access.isPrivileged) notFound()

  const orgIds = await getOrgIdsOfUser()
  const [fiche, network] = await Promise.all([getPersonFiche(contactId, orgIds), getActorNetwork(`p_${contactId}`, orgIds)])
  if (!fiche) notFound()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/intervenants" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        ← Intervenants
      </Link>
      <PersonFicheBody fiche={fiche} network={network} />
    </div>
  )
}
