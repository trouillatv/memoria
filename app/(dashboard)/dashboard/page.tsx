import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { listContracts } from '@/lib/db/contracts'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { listMissionsByContract } from '@/lib/db/missions'
import { listInterventionsByContract, listPhotosByIntervention } from '@/lib/db/interventions'
import { EngagementCompliance } from '../contracts/[id]/engagement-compliance'
import type { EngagementComplianceRatios } from '@/types/db'
import { cn } from '@/lib/utils'

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

  // Photos count
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
  const contracts = await listContracts()
  const summaries = await Promise.all(
    contracts.map((c) => summarizeContract(c.id, c.name, c.client_name, c.status)),
  )

  const active = summaries.filter((s) => s.status === 'active')
  const others = summaries.filter((s) => s.status !== 'active')
  const attention = active.filter((s) => s.needsAttention)
  const ok = active.filter((s) => !s.needsAttention)

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-emerald-600" />
          Tableau de bord
        </h1>
        <p className="text-sm text-muted-foreground">
          Vue d&apos;ensemble des contrats actifs et de leur progression sur les engagements.
        </p>
      </header>

      {contracts.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={Sparkles}
            title="Commencez par votre premier AO"
            description="NetoIAge vous accompagne du dépouillement de l'appel d'offres à la production des preuves d'exécution. Tout commence par l'import d'un AO."
            primaryAction={
              <Link
                href="/tenders/new"
                className={cn(buttonVariants({ variant: 'default' }))}
              >
                Importer un AO
              </Link>
            }
            secondaryAction={
              <Link
                href="/contracts"
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                Voir mes contrats
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {attention.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
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
        </>
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
