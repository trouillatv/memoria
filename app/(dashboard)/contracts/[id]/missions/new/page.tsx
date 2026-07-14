import { notFound } from 'next/navigation'
import { requireDeskUser } from '@/lib/auth/page-guard'
import { getContract } from '@/lib/db/contracts'
import { listSitesByContract, listSitesGlobal } from '@/lib/db/sites'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { MissionEditor } from '../[missionId]/edit/mission-editor'

export default async function NewMissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ site?: string }>
}) {
  await requireDeskUser()
  const { id } = await params
  const { site: defaultSiteId } = await searchParams
  const contract = await getContract(id)
  if (!contract) notFound()

  const [sites, engagements, allSites] = await Promise.all([
    listSitesByContract(id),
    listEngagementsByContract(id),
    listSitesGlobal(),
  ])
  // Sites rattachés à d'autres contrats (réutilisation cross-contrat).
  const contractSiteIds = new Set(sites.map((s) => s.id))
  const otherSites = allSites
    .filter((s) => !contractSiteIds.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, contract_name: s.contract_name }))

  if (sites.length === 0 && otherSites.length === 0) {
    return (
      <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-6">
        <p className="text-sm text-amber-800">
          Aucun site sur ce contrat. Ajoutez d&apos;abord un site avant de créer une mission.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 w-full">
      <header>
        <h1 className="text-2xl font-semibold">Nouvelle mission</h1>
        <p className="text-sm text-muted-foreground">{contract.name}</p>
      </header>

      <MissionEditor
        mode="create"
        contractId={id}
        sites={sites}
        otherSites={otherSites}
        engagements={engagements}
        defaultSiteId={defaultSiteId}
      />
    </div>
  )
}
