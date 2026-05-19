import { notFound } from 'next/navigation'
import Link from 'next/link'
import { FileBarChart, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  getContract,
  getContractContinuity,
  getContractVitals,
  getContractExpiry,
  getContractMemory,
} from '@/lib/db/contracts'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { listMissionsByContract } from '@/lib/db/missions'
import { listInterventionsByContract, listPhotosByIntervention } from '@/lib/db/interventions'
import { EngagementCompliance } from './engagement-compliance'
import { ContractTabs } from './contract-tabs'
import { DynamicCrumb } from '@/components/layout/BreadcrumbProvider'
import { DossierConfidenceBadge } from '@/components/ui/dossier-confidence-badge'
import { getContractSummaries } from '@/lib/db/dashboard'
import type { EngagementComplianceRatios } from '@/types/db'

const COMPLETED_STATUSES = new Set(['completed', 'validated'])

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contract = await getContract(id)
  if (!contract) notFound()

  const [engagements, missions, interventions, continuity, summaryMap, vitals, expiry, memory] =
    await Promise.all([
      listEngagementsByContract(id),
      listMissionsByContract(id),
      listInterventionsByContract(id),
      getContractContinuity(id),
      getContractSummaries([id]),
      getContractVitals(id),
      getContractExpiry(id),
      getContractMemory(id),
    ])
  const summary = summaryMap.get(id) ?? null

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
  const interventionsByEngagement = new Map<string, { total: number; executed: number; proven: number; validated: number }>()

  for (const m of missions) {
    const eIds = missionEngagements.get(m.id) ?? []
    for (const eId of eIds) {
      planned.add(eId)
      if (!interventionsByEngagement.has(eId)) {
        interventionsByEngagement.set(eId, { total: 0, executed: 0, proven: 0, validated: 0 })
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
        if (intv.status === 'validated') acc.validated += 1
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
    const validated = (stats?.executed ?? 0) > 0 ? (stats?.validated ?? 0) / (stats?.executed ?? 0) : 0
    return {
      promised,
      planned: isPlanned ? 1 : 0,
      executed,
      proven,
      validated,
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

  const unplannedEngagements = engagements.filter((e) => !planned.has(e.id))
  const unplannedCount = unplannedEngagements.length

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Enregistre le nom du contrat dans le breadcrumb (remplace l'UUID). */}
      <DynamicCrumb segmentId={contract.id} label={contract.name} />
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold">{contract.name}</h1>
              <StatusBadge status={contract.status} size="md" />
              {summary && summary.engagementsTotal > 0 && (
                <DossierConfidenceBadge
                  level={summary.confidenceLevel}
                  proofCoverage={summary.proofCoverage}
                />
              )}
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
          </div>
          <Link href={`/contracts/${id}/rapport-mensuel`} className="shrink-0">
            <Button variant="outline">
              <FileBarChart className="h-4 w-4" />
              Rapport mensuel
            </Button>
          </Link>
        </div>
      </header>

      <ContractTabs contractId={id} active="overview" />

      {/* V6.3 — Vitalité du contrat. Doctrine V6.3 (factuel, jamais narré) +
          V6.4 (jamais score). Lecture seule, sobre : aucun %, aucun score,
          aucune notion de sous/surconsommation, aucune alerte rouge. Objectif
          et documenté = faits SÉPARÉS, jamais un ratio. */}
      <section className="rounded-lg border bg-card p-4" data-testid="contract-vitalite">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Vitalité du contrat
        </h2>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Objectif horaire déclaré</dt>
            <dd className="font-semibold tabular-nums">
              {vitals.volumeHoraireMensuelPrevu != null
                ? `${vitals.volumeHoraireMensuelPrevu} h/mois`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Prestations documentées (ce mois)</dt>
            <dd className="font-semibold tabular-nums">
              {vitals.prestationsDocumenteesCeMois}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Prestations documentées (cumul)</dt>
            <dd className="font-semibold tabular-nums">
              {vitals.prestationsDocumenteesCumul}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Fréquence</dt>
            <dd className="font-semibold">{contract.frequence ?? '—'}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-xs text-muted-foreground">Échéance</dt>
            <dd className="font-medium">
              {expiry.kind === 'none' ? '—' : expiry.label}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">AO lié</dt>
            <dd className="font-medium">
              {contract.tender_id ? (
                <Link
                  href={`/tenders/${contract.tender_id}`}
                  className="underline hover:text-foreground"
                >
                  Voir →
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        {memory.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="text-xs text-muted-foreground mb-1.5">Mémoire contractuelle</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {memory.map((f, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="shrink-0 text-muted-foreground/60">•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Sprint 5 UX-9 — Continuité du service (Doctrine V5).
          Compteurs factuels passifs. Pas de score, pas de comparaison entre
          contrats. Argument commercial par l'évidence. */}
      {continuity && continuity.totalExecutedInterventions > 0 && (
        <section
          className="rounded-lg border bg-card p-4"
          data-testid="contract-continuity"
        >
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Continuité du service
          </h2>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Depuis le démarrage</dt>
              <dd className="font-semibold tabular-nums">
                {continuity.daysSinceStart} jours
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Dernière intervention</dt>
              <dd className="font-semibold tabular-nums">
                {continuity.daysSinceLastIntervention === 0
                  ? "Aujourd'hui"
                  : `il y a ${continuity.daysSinceLastIntervention} jour${continuity.daysSinceLastIntervention > 1 ? 's' : ''}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Mois consécutifs couverts</dt>
              <dd className="font-semibold tabular-nums">
                {continuity.consecutiveMonthsWithIntervention}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Semaines sans rupture</dt>
              <dd className="font-semibold tabular-nums">
                {continuity.weeksWithoutInterruption}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* Avertissement : engagements non couverts par aucune mission.
          Placé juste après "Continuité du service" pour le voir en haut,
          avant la liste détaillée des promesses ci-dessous. */}
      {unplannedCount > 0 && (
        <section
          aria-labelledby="unplanned-engagements-heading"
          className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 space-y-3"
        >
          <h2
            id="unplanned-engagements-heading"
            className="text-sm font-semibold inline-flex items-center gap-2 text-amber-900"
          >
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Promesses non couvertes par une mission ({unplannedCount})
          </h2>
          <p className="text-xs text-amber-900/80">
            Ces engagements contractuels ne sont rattachés à aucune mission.
            Tant qu&apos;ils ne sont pas cochés dans la fiche d&apos;une mission,
            ils ne contribueront pas à la preuve de tenue du contrat — même
            si le travail est physiquement effectué.
          </p>
          <ul className="space-y-1.5 text-sm">
            {unplannedEngagements.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2">
                <span className="text-amber-700 shrink-0">•</span>
                <span>
                  <span className="font-medium text-amber-900">{e.short_label}</span>
                  {e.source_excerpt && (
                    <span className="text-amber-900/70 italic">
                      {' '}— « {e.source_excerpt.slice(0, 80)}
                      {e.source_excerpt.length > 80 ? '…' : ''} »
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href={`/contracts/${id}/missions`}
            className="inline-flex items-center text-xs font-medium text-amber-900 hover:text-amber-950 underline underline-offset-4"
          >
            Aller aux missions pour les rattacher →
          </Link>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Promesses du contrat ({engagements.length})
          </h2>
          {engagements.length > 0 && unplannedCount > 0 && (
            <Link
              href={`/contracts/${id}/missions`}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {unplannedCount} promesse{unplannedCount > 1 ? 's' : ''} non couverte{unplannedCount > 1 ? 's' : ''} →
            </Link>
          )}
        </div>

        {engagements.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border p-4">
            Aucune promesse active sur ce contrat.
          </p>
        ) : (
          <ul className="space-y-3">
            {engagements.map((e) => (
              <li key={e.id} className="rounded-lg border p-4 bg-card">
                <div className="min-w-0 mb-3">
                  <div className="text-sm font-semibold mb-0.5">{e.short_label}</div>
                  <div className="text-[11px] text-muted-foreground italic line-clamp-2">
                    « {e.source_excerpt} »
                  </div>
                </div>
                <EngagementCompliance ratios={computeRatios(e.id)} size="medium" />
              </li>
            ))}
          </ul>
        )}

      </section>
    </div>
  )
}
