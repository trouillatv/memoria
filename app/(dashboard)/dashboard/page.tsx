import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listContracts } from '@/lib/db/contracts'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { listMissionsByContract } from '@/lib/db/missions'
import { listInterventionsByContract, countPhotosByInterventions } from '@/lib/db/interventions'
import { getOnboardingProgress } from '@/lib/db/onboarding'
import {
  getWeekPulse,
  getCapitalPreuves,
  getAOPipeline,
  getOpenAnomaliesStats,
  getAtRiskEngagements,
  getContractsUnderTension,
  getRecentActivity,
} from '@/lib/db/dashboard'
import { EngagementCompliance } from '../contracts/[id]/engagement-compliance'
import type { EngagementComplianceRatios } from '@/types/db'
import { WelcomeCard } from './WelcomeCard'
import { DashboardHeader } from './DashboardHeader'
import { StatsBand } from './StatsBand'
import { AtRiskEngagementsWidget } from './AtRiskEngagementsWidget'
import { ContractsUnderTensionWidget } from './ContractsUnderTensionWidget'
import { RecentActivityWidget } from './RecentActivityWidget'
import { AnomaliesOldWidget } from './AnomaliesOldWidget'

const COMPLETED_STATUSES = new Set(['completed', 'validated'])

interface ContractSummary {
  id: string
  name: string
  client: string
  status: string
  engagementsTotal: number
  averageRatios: EngagementComplianceRatios
  needsAttention: boolean
}

async function summarizeContract(contractId: string, contractName: string, clientName: string, status: string): Promise<ContractSummary> {
  const [engagements, missions, interventions] = await Promise.all([
    listEngagementsByContract(contractId),
    listMissionsByContract(contractId),
    listInterventionsByContract(contractId),
  ])

  // Build mission_id → engagement_ids map
  const missionEngagements = new Map<string, string[]>()
  for (const m of missions) {
    missionEngagements.set(m.id, Array.isArray(m.engagement_ids) ? m.engagement_ids : [])
  }

  // Photos count — 1 query batch au lieu de N (1 par intervention finie)
  const completedInterventionIds = interventions
    .filter((i) => COMPLETED_STATUSES.has(i.status))
    .map((i) => i.id)
  const interventionPhotosCount = await countPhotosByInterventions(completedInterventionIds)

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

  // Average ratios across engagements
  const n = engagements.length
  if (n === 0) {
    return {
      id: contractId, name: contractName, client: clientName, status,
      engagementsTotal: 0,
      averageRatios: { promised: false, planned: 0, executed: 0, proven: 0, validated: 0 },
      needsAttention: false,
    }
  }

  let plannedSum = 0
  let executedSum = 0
  let provenSum = 0
  let validatedSum = 0
  for (const e of engagements) {
    const stats = interventionsByEngagement.get(e.id)
    plannedSum += planned.has(e.id) ? 1 : 0
    const total = stats?.total ?? 0
    executedSum += total > 0 ? (stats?.executed ?? 0) / total : 0
    provenSum += (stats?.executed ?? 0) > 0 ? (stats?.proven ?? 0) / (stats?.executed ?? 0) : 0
    validatedSum += (stats?.executed ?? 0) > 0 ? (stats?.validated ?? 0) / (stats?.executed ?? 0) : 0
  }

  const avg: EngagementComplianceRatios = {
    promised: true,
    planned: plannedSum / n,
    executed: executedSum / n,
    proven: provenSum / n,
    validated: validatedSum / n,
  }

  // « Needs attention » : tout segment en dessous de 0.7
  const minSegment = Math.min(avg.planned, avg.executed, avg.proven, avg.validated)
  const needsAttention = minSegment < 0.7 && avg.planned > 0  // ignore les contrats vides

  return {
    id: contractId, name: contractName, client: clientName, status,
    engagementsTotal: n,
    averageRatios: avg,
    needsAttention,
  }
}

export default async function DashboardPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  // Queries en parallèle : page-globales + helpers cockpit 11.0.
  const [
    contracts,
    onboarding,
    weekPulse,
    capital,
    aoPipeline,
    anomaliesStats,
    atRiskEngagements,
    contractsUnderTension,
    recentActivity,
  ] = await Promise.all([
    listContracts(),
    getOnboardingProgress(),
    getWeekPulse(),
    getCapitalPreuves(),
    getAOPipeline(),
    getOpenAnomaliesStats(),
    getAtRiskEngagements(),
    getContractsUnderTension(),
    getRecentActivity(8),
  ])

  // Tant qu'aucun contrat actif n'existe, on affiche la welcome card 4-étapes
  // SEULE (mode bootstrap). Le rideau tombe automatiquement dès qu'un contrat
  // actif est créé : doctrine = aucune action user requise.
  const showWelcome = !onboarding.hasActiveContract
  if (showWelcome) {
    return (
      <div className="space-y-6 max-w-5xl">
        <WelcomeCard progress={onboarding} />
      </div>
    )
  }

  // Mode cockpit : header chaleureux + bandeau 4 stats + sections contrats existantes.
  const summaries = await Promise.all(
    contracts.map((c) => summarizeContract(c.id, c.name, c.client_name, c.status)),
  )
  const active = summaries.filter((s) => s.status === 'active')
  const others = summaries.filter((s) => s.status !== 'active')
  const attention = active.filter((s) => s.needsAttention)
  const ok = active.filter((s) => !s.needsAttention)

  const firstName = user.full_name?.split(' ')[0] ?? 'là'

  return (
    <div className="space-y-8 max-w-6xl">
      <DashboardHeader
        firstName={firstName}
        activeContractsCount={active.length}
      />

      <StatsBand
        weekPulse={weekPulse}
        capital={capital}
        aoPipeline={aoPipeline}
        anomalies={anomaliesStats}
      />

      <AtRiskEngagementsWidget engagements={atRiskEngagements} />

      <ContractsUnderTensionWidget contracts={contractsUnderTension} />

      <RecentActivityWidget events={recentActivity} />

      <AnomaliesOldWidget oldCount={anomaliesStats.oldCount} />

      {/* Sections contrats existantes — préservées telles quelles. */}
      {attention.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
          {/* Encadré ambre — JAMAIS rouge. La doctrine "sobriété calme" exige
              un signal présent mais posé. Pas d'animation, pas d'exclamation. */}
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Demandent attention ({attention.length})
          </h2>
          <ul className="space-y-2">
            {attention.map((c) => <ContractRow key={c.id} summary={c} />)}
          </ul>
        </section>
      )}

      {ok.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            En bonne progression ({ok.length})
          </h2>
          <ul className="space-y-2">
            {ok.map((c) => <ContractRow key={c.id} summary={c} />)}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Inactifs ({others.length})
          </h2>
          <ul className="space-y-2">
            {others.map((c) => <ContractRow key={c.id} summary={c} muted />)}
          </ul>
        </section>
      )}
    </div>
  )
}

function ContractRow({ summary, muted }: { summary: ContractSummary; muted?: boolean }) {
  return (
    <li className={`rounded-lg border p-4 bg-card ${muted ? 'opacity-70' : ''}`}>
      <Link href={`/contracts/${summary.id}`} className="block hover:bg-muted/20 -m-4 p-4 rounded-lg transition-colors">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold mb-0.5">{summary.name}</div>
            <div className="text-xs text-muted-foreground">
              {summary.client} · {summary.engagementsTotal} engagement{summary.engagementsTotal > 1 ? 's' : ''}
            </div>
          </div>
          {summary.engagementsTotal > 0 && (
            <EngagementCompliance ratios={summary.averageRatios} size="compact" />
          )}
        </div>
      </Link>
    </li>
  )
}
