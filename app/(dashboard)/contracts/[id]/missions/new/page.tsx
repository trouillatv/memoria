import { notFound } from 'next/navigation'
import { getContract } from '@/lib/db/contracts'
import { listSitesByContract } from '@/lib/db/sites'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { MissionEditor } from '../[missionId]/edit/mission-editor'

export default async function NewMissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ site?: string }>
}) {
  const { id } = await params
  const { site: defaultSiteId } = await searchParams
  const contract = await getContract(id)
  if (!contract) notFound()

  const [sites, engagements] = await Promise.all([
    listSitesByContract(id),
    listEngagementsByContract(id),
  ])

  if (sites.length === 0) {
    return (
      <div className="max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-6">
        <p className="text-sm text-amber-800">
          Aucun site sur ce contrat. Ajoutez d&apos;abord un site avant de créer une mission.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Nouvelle mission</h1>
        <p className="text-sm text-muted-foreground">{contract.name}</p>
      </header>

      <MissionEditor
        mode="create"
        contractId={id}
        sites={sites}
        engagements={engagements}
        defaultSiteId={defaultSiteId}
      />
    </div>
  )
}
