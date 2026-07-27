// Fiche ENTREPRISE (Lot 2B.3B) — surface de LECTURE d'une entreprise (companies).
// Le CORPS est partagé avec le panneau maître-détail (CompanyFicheBody). Cette page
// n'ajoute que le chrome (garde d'accès + fil d'Ariane). Ordre : Situation → Présence
// opérationnelle → Contacts → Travail en cours → Historique. Le VOLUME seul ne dégrade
// jamais l'état ; statut par chantier, pas de raccourci global.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getCompanyFiche } from '@/lib/db/company-fiche'
import { getActorNetwork } from '@/lib/knowledge/actors-graph'
import { CompanyFicheBody } from '../../CompanyFicheBody'

export const dynamic = 'force-dynamic'

export default async function CompanyFichePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  const access = await checkIntervenantsPageAccess(null)
  if (!access.allowed) {
    if (access.reason === 'unauthenticated') redirect('/login')
    notFound()
  }
  if (!access.access.isPrivileged) notFound()

  const orgIds = await getOrgIdsOfUser()
  const [fiche, network] = await Promise.all([getCompanyFiche(companyId, orgIds), getActorNetwork(`co_${companyId}`, orgIds)])
  if (!fiche) notFound()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/intervenants" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        ← Intervenants
      </Link>
      <CompanyFicheBody fiche={fiche} network={network} />
    </div>
  )
}
