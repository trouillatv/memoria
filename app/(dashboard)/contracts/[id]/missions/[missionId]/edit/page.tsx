import { notFound } from 'next/navigation'
import { getContract } from '@/lib/db/contracts'
import { getMission } from '@/lib/db/missions'
import { listSitesByContract } from '@/lib/db/sites'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { MissionEditor } from './mission-editor'

export default async function EditMissionPage({
  params,
}: {
  params: Promise<{ id: string; missionId: string }>
}) {
  const { id, missionId } = await params
  const [contract, mission] = await Promise.all([
    getContract(id),
    getMission(missionId),
  ])
  if (!contract || !mission) notFound()

  const [sites, engagements] = await Promise.all([
    listSitesByContract(id),
    listEngagementsByContract(id),
  ])

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Édition mission</h1>
        <p className="text-sm text-muted-foreground">
          {contract.name} · {sites.find((s) => s.id === mission.site_id)?.name ?? '—'}
        </p>
      </header>

      <MissionEditor
        mode="edit"
        contractId={id}
        sites={sites}
        engagements={engagements}
        initialMission={mission}
      />
    </div>
  )
}
