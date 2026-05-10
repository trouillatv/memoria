import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getContract } from '@/lib/db/contracts'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { listMissionsByContract } from '@/lib/db/missions'
import { listInterventionsByContract, listPhotosByIntervention } from '@/lib/db/interventions'
import { EngagementCompliance } from './engagement-compliance'
import { ContractTabs } from './contract-tabs'
import type { EngagementComplianceRatios } from '@/types/db'

function categoryColorClass(category: string): string {
  switch (category) {
    case 'frequency':  return 'text-sky-700 bg-sky-50 border-sky-200'
    case 'quality':    return 'text-emerald-700 bg-emerald-50 border-emerald-200'
    case 'compliance': return 'text-violet-700 bg-violet-50 border-violet-200'
    case 'delivery':   return 'text-orange-700 bg-orange-50 border-orange-200'
    case 'sla':        return 'text-amber-700 bg-amber-50 border-amber-200'
    case 'reporting':  return 'text-indigo-700 bg-indigo-50 border-indigo-200'
    default:           return 'text-slate-700 bg-slate-50 border-slate-200'
  }
}

const COMPLETED_STATUSES = new Set(['completed', 'validated'])

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contract = await getContract(id)
  if (!contract) notFound()

  const [engagements, missions, interventions] = await Promise.all([
    listEngagementsByContract(id),
    listMissionsByContract(id),
    listInterventionsByContract(id),
  ])

  // Build mission_id → engagement_ids map
  const missionEngagements = new Map<string, string[]>()
  for (const m of missions) {
    missionEngagements.set(m.id, Array.isArray(m.engagement_ids) ? m.engagement_ids : [])
  }

  // For each completed/validated intervention : load photos count (1 query each — acceptable for MVP)
  // For better perf later, switch to a single SQL aggregate
  const interventionPhotosCount = new Map<string, number>()
  await Promise.all(
    interventions
      .filter((i) => COMPLETED_STATUSES.has(i.status))
      .map(async (i) => {
        const photos = await listPhotosByIntervention(i.id)
        interventionPhotosCount.set(i.id, photos.length)
      }),
  )

  // Per-engagement aggregates
  const planned = new Set<string>()
  const interventionsByEngagement = new Map<string, { total: number; executed: number; proven: number }>()

  for (const m of missions) {
    const eIds = missionEngagements.get(m.id) ?? []
    for (const eId of eIds) {
      planned.add(eId)
      if (!interventionsByEngagement.has(eId)) {
        interventionsByEngagement.set(eId, { total: 0, executed: 0, proven: 0 })
      }
    }
  }

  for (const intv of interventions) {
    const eIds = missionEngagements.get(intv.mission_id) ?? []
    for (const eId of eIds) {
      const acc = interventionsByEngagement.get(eId)
      if (!acc) continue
      acc.total += 1
      if (COMPLETED_STATUSES.has(intv.status)) {
        acc.executed += 1
        if ((interventionPhotosCount.get(intv.id) ?? 0) > 0) acc.proven += 1
      }
    }
  }

  function computeRatios(engagementId: string): EngagementComplianceRatios {
    const stats = interventionsByEngagement.get(engagementId)
    const promised = true
    const isPlanned = planned.has(engagementId)
    const total = stats?.total ?? 0
    const executed = total > 0 ? (stats?.executed ?? 0) / total : 0
    const proven = (stats?.executed ?? 0) > 0 ? (stats?.proven ?? 0) / (stats?.executed ?? 0) : 0
    return {
      promised,
      planned: isPlanned ? 1 : 0,
      executed,
      proven,
      validated: 0, // Slice 2.4
    }
  }

  const startLabel = new Date(contract.start_date).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  const endLabel = contract.end_date
    ? new Date(contract.end_date).toLocaleDateString('fr-FR', {
        day: '2-digit', month: 'long', year: 'numeric',
      })
    : null

  const unplannedCount = engagements.filter((e) => !planned.has(e.id)).length

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{contract.name}</h1>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium uppercase tracking-wider bg-emerald-50 border-emerald-200 text-emerald-700">
            {contract.status}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {contract.client_name} · démarré le {startLabel}
          {endLabel && ` · jusqu'au ${endLabel}`}
        </p>
        {contract.tender_id && (
          <p className="text-xs text-muted-foreground">
            <Link href={`/tenders/${contract.tender_id}`} className="underline hover:text-foreground">
              Voir l&apos;AO d&apos;origine →
            </Link>
          </p>
        )}
      </header>

      <ContractTabs contractId={id} active="overview" />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Engagements ({engagements.length})
          </h2>
          {engagements.length > 0 && unplannedCount > 0 && (
            <Link
              href={`/contracts/${id}/missions`}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {unplannedCount} engagement{unplannedCount > 1 ? 's' : ''} non couvert{unplannedCount > 1 ? 's' : ''} →
            </Link>
          )}
        </div>

        {engagements.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border p-4">
            Aucun engagement actif sur ce contrat.
          </p>
        ) : (
          <ul className="space-y-3">
            {engagements.map((e) => (
              <li key={e.id} className="rounded-lg border p-4 bg-card">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold mb-0.5">{e.short_label}</div>
                    <div className="text-[11px] text-muted-foreground italic line-clamp-2">
                      « {e.source_excerpt} »
                    </div>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] uppercase font-semibold tracking-widest shrink-0 ${categoryColorClass(e.category)}`}>
                    {e.category}
                  </span>
                </div>
                <EngagementCompliance ratios={computeRatios(e.id)} size="medium" />
              </li>
            ))}
          </ul>
        )}

        {engagements.length > 0 && (
          <p className="text-[11px] text-muted-foreground italic mt-4 rounded-lg border border-dashed p-3 bg-muted/30">
            La phase <strong>validation</strong> sera alimentée à la slice 2.4 (validation superviseur).
          </p>
        )}
      </section>
    </div>
  )
}
