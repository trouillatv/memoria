import { notFound } from 'next/navigation'
import { getContract } from '@/lib/db/contracts'
import { getMission } from '@/lib/db/missions'
import { listSitesByContract } from '@/lib/db/sites'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { listTemplatesForMission } from '@/lib/db/intervention-templates'
import { describeTemplate } from '@/lib/recurrence/describe'
import { MissionEditor } from './mission-editor'
import { RecurrenceSection } from './RecurrenceSection'

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

  const [sites, engagements, templates] = await Promise.all([
    listSitesByContract(id),
    listEngagementsByContract(id),
    listTemplatesForMission(missionId),
  ])

  const activeTemplates = templates.filter((t) => t.active)

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

      {/* Recurrence section — Slice 6.2 */}
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Récurrence</h3>
            <p className="text-[11px] text-muted-foreground">
              Indiquez quand cette mission revient. Le système crée les interventions au fil de l&apos;eau.
            </p>
          </div>
          <RecurrenceSection
            missionId={mission.id}
            missionName={mission.name}
            contractId={id}
          />
        </div>

        {activeTemplates.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Aucune récurrence pour cette mission.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {activeTemplates.map((t) => (
              <li
                key={t.id}
                className="text-sm rounded border bg-background p-2.5 flex items-start gap-2"
              >
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>{describeTemplate(t)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
