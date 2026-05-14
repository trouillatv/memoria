import { notFound } from 'next/navigation'
import { getContract } from '@/lib/db/contracts'
import { getMission } from '@/lib/db/missions'
import { listSitesByContract } from '@/lib/db/sites'
import { listEngagementsByContract } from '@/lib/db/engagements'
import {
  getTemplateStatsBatch,
  listTemplatesForMission,
} from '@/lib/db/intervention-templates'
import { describeTemplate, formatDateFr } from '@/lib/recurrence/describe'
import { MissionEditor } from './mission-editor'
import { RecurrenceSection } from './RecurrenceSection'
import { RecurrenceRowActions } from './RecurrenceRowActions'
import { DynamicCrumb } from '@/components/layout/BreadcrumbProvider'
import type { InterventionStatus } from '@/types/db'

// Wording statut FR — aggregate, jamais d'identite d'agent.
const STATUS_LABEL_FR: Record<InterventionStatus, string> = {
  planned: 'planifiée',
  in_progress: 'en cours',
  completed: 'terminée',
  validated: 'validée',
  skipped: 'sautée',
}

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
  const stats = await getTemplateStatsBatch(activeTemplates.map((t) => t.id))

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb : remplace les UUIDs par les noms (Contrats > [contrat] >
          Missions > [mission] > Édition). */}
      <DynamicCrumb segmentId={contract.id} label={contract.name} />
      <DynamicCrumb segmentId={mission.id} label={mission.name} />
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

      {/* Recurrence section — Slice 6.2 / Slice 6.5 */}
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
          <ul className="space-y-2">
            {activeTemplates.map((t) => {
              const s = stats.get(t.id)
              const lastLabel = s?.lastInterventionDate
                ? `Dernière intervention : ${formatDateFr(s.lastInterventionDate)}` +
                  (s.lastInterventionStatus
                    ? ` (${STATUS_LABEL_FR[s.lastInterventionStatus] ?? s.lastInterventionStatus})`
                    : '')
                : 'Aucune intervention encore'
              const nextLabel = s?.nextInterventionDate
                ? `Prochaine intervention prévue : ${formatDateFr(s.nextInterventionDate)}`
                : 'Aucune intervention planifiée'
              const weekCount = s?.interventionsThisWeek ?? 0
              const weekLabel =
                weekCount === 0
                  ? 'Aucune intervention cette semaine'
                  : weekCount === 1
                    ? '1 intervention cette semaine'
                    : `${weekCount} interventions cette semaine`

              return (
                <li
                  key={t.id}
                  data-testid={`recurrence-row-${t.id}`}
                  className="text-sm rounded border bg-background p-3"
                >
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="font-medium">{describeTemplate(t)}</p>
                      <p className="text-xs text-muted-foreground">{lastLabel}</p>
                      <p className="text-xs text-muted-foreground">{nextLabel}</p>
                      <p className="text-xs text-muted-foreground">{weekLabel}</p>
                    </div>
                    <RecurrenceRowActions
                      template={t}
                      missionId={mission.id}
                      missionName={mission.name}
                      contractId={id}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
