import { notFound } from 'next/navigation'
import { requireDeskUser } from '@/lib/auth/page-guard'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteById, listSitesGlobal } from '@/lib/db/sites'
import { listActiveEngagementsByContracts, listActiveEngagementsBySites } from '@/lib/db/engagements'
import { MissionEditor } from '@/app/(dashboard)/contracts/[id]/missions/[missionId]/edit/mission-editor'

// P0-3.5B (GO Vincent 2026-09-26) — entrée site-first pour créer une Mission
// depuis un Engagement actif « Planifier », y compris un Engagement Porte B
// sur un chantier SANS contrat. Miroir de contracts/[id]/missions/new/page.tsx
// mais résolu à partir du chantier plutôt que du contrat : ne jamais exiger,
// inventer, ni rediriger vers un contrat placeholder. La route contrat-first
// existante reste inchangée pour les entrées depuis la fiche contrat.
export default async function NewSiteMissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ engagement?: string }>
}) {
  await requireDeskUser()
  const { id } = await params
  const { engagement: defaultEngagementId } = await searchParams

  // Même frontière d'organisation que le reste de l'espace chantier
  // (getSiteIdentity → resolveResourceAccess) : un chantier d'une autre
  // organisation reste indiscernable d'un chantier inexistant.
  const identity = await getSiteIdentity(id)
  if (!identity) notFound()

  const site = await getSiteById(id)
  if (!site) notFound()

  const allSites = await listSitesGlobal()
  const otherSites = allSites
    .filter((s) => s.id !== id)
    .map((s) => ({ id: s.id, name: s.name, contract_name: s.contract_name, contract_id: s.contract_id }))

  // Préchargement batché (Option A, P0-3.5A) : ce chantier peut être Porte A
  // (contract_id renseigné) et/ou Porte B (engagements rattachés directement
  // au chantier) — jamais de contrat fictif si contract_id est null.
  const relevantContractIds = Array.from(new Set([
    ...(site.contract_id ? [site.contract_id] : []),
    ...otherSites.map((s) => s.contract_id).filter((cid): cid is string => !!cid),
  ]))
  const relevantSiteIds = Array.from(new Set([id, ...otherSites.map((s) => s.id)]))
  const [contractEngagementsMap, siteEngagementsMap] = await Promise.all([
    listActiveEngagementsByContracts(relevantContractIds),
    listActiveEngagementsBySites(relevantSiteIds),
  ])
  const contractEngagements = Object.fromEntries(contractEngagementsMap)
  const siteEngagements = Object.fromEntries(siteEngagementsMap)

  return (
    <div className="space-y-6 w-full">
      <header>
        <h1 className="text-2xl font-semibold">Nouvelle mission</h1>
        <p className="text-sm text-muted-foreground">{identity.name}</p>
      </header>

      <MissionEditor
        mode="create"
        contractId={site.contract_id}
        sites={[site]}
        otherSites={otherSites}
        contractEngagements={contractEngagements}
        siteEngagements={siteEngagements}
        defaultSiteId={id}
        defaultEngagementIds={defaultEngagementId ? [defaultEngagementId] : undefined}
      />
    </div>
  )
}
