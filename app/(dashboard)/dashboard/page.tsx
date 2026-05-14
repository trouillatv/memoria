import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listContracts } from '@/lib/db/contracts'
import { getOnboardingProgress } from '@/lib/db/onboarding'
import {
  getWeekPulse,
  getCapitalPreuves,
  getAOPipeline,
  getOpenAnomaliesStats,
  getAtRiskEngagements,
  getContractsUnderTension,
  getRecentActivity,
  getTenantCumulativeStats,
  getContractSummaries,
} from '@/lib/db/dashboard'
import { countClosedThisMonth } from '@/lib/db/proof-share'
import { EngagementCompliance } from '../contracts/[id]/engagement-compliance'
import type { EngagementComplianceRatios } from '@/types/db'
import { WelcomeCard } from './WelcomeCard'
import { DashboardHeader } from './DashboardHeader'
import { StatsBand } from './StatsBand'
import { AtRiskEngagementsWidget } from './AtRiskEngagementsWidget'
import { ContractsUnderTensionWidget } from './ContractsUnderTensionWidget'
import { RecentActivityWidget } from './RecentActivityWidget'
import { AnomaliesOldWidget } from './AnomaliesOldWidget'
import { TenantMorningReadingCard } from './TenantMorningReadingCard'
import { getTenantTopMorningReading } from '@/lib/db/site-cockpit'

/**
 * Sprint 6 — Helper wrapper sur countClosedThisMonth() pour le widget
 * "N dossiers clôturés ce mois". Doctrine V5 verrou V3 : on garde le
 * verbe "clôturer", on ne dit JAMAIS "résolu". Silence positif si N = 0.
 */
async function getDossiersClosedThisMonth(): Promise<number> {
  return countClosedThisMonth()
}

interface ContractSummary {
  id: string
  name: string
  client: string
  status: string
  engagementsTotal: number
  averageRatios: EngagementComplianceRatios
  needsAttention: boolean
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
    dossiersClosedThisMonth,
    tenantCumulative,
    morningReading,
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
    getDossiersClosedThisMonth(),
    getTenantCumulativeStats(),
    getTenantTopMorningReading(),
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
  // Perf : 1 seule RPC SQL au lieu de N×4 queries (migration 039).
  const summaryMap = await getContractSummaries(contracts.map((c) => c.id))
  const summaries: ContractSummary[] = contracts.map((c) => {
    const s = summaryMap.get(c.id)
    return {
      id: c.id,
      name: c.name,
      client: c.client_name,
      status: c.status,
      engagementsTotal: s?.engagementsTotal ?? 0,
      averageRatios: s?.averageRatios ?? {
        promised: false, planned: 0, executed: 0, proven: 0, validated: 0,
      },
      needsAttention: s?.needsAttention ?? false,
    }
  })
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

      {/* V5.1.4 — "Ce que les lieux disent ce matin" (Vincent 2026-05-15).
          1 fragment max. Si rien d'émergent → la Card ne s'affiche pas.
          Phénomène rare, pas un feed. */}
      <TenantMorningReadingCard data={morningReading} />

      {/* Sprint 3 — UX-8 Mode litige express : bouton sobre, immédiatement
          visible, jamais alarmant. Doctrine V5 verrou V4 : wording strictement
          passif (« Préparer ma défense », pas « ALERTE litige »). */}
      <div>
        <Link href="/litige" data-testid="dashboard-litige-link">
          <Button
            variant="outline"
            className="border-amber-200 text-amber-900 hover:bg-amber-50"
          >
            <Shield className="h-4 w-4 mr-2" />
            Préparer ma défense
          </Button>
        </Link>
      </div>

      <StatsBand
        weekPulse={weekPulse}
        capital={capital}
        aoPipeline={aoPipeline}
        anomalies={anomaliesStats}
      />

      {/* Sprint 6 — Compteur calme "Dossiers clôturés ce mois" (verrou V3).
          Silence positif : on n'affiche RIEN si 0 (pas d'état vide pesant). */}
      {dossiersClosedThisMonth > 0 && (
        <p
          data-testid="dossiers-closed-this-month"
          className="text-sm text-slate-700"
        >
          <span className="tabular-nums font-semibold">
            {dossiersClosedThisMonth.toLocaleString('fr-FR')}
          </span>{' '}
          dossier{dossiersClosedThisMonth > 1 ? 's' : ''} clôturé
          {dossiersClosedThisMonth > 1 ? 's' : ''} ce mois.
        </p>
      )}

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

      {/* Sprint 5 UX-9 — Bandeau Capital cumulé tenant (Doctrine V5).
          Ligne unique très sobre, gris muted. Compteurs factuels passifs.
          Pas un widget hero. Argument commercial par l'évidence. */}
      {(tenantCumulative.totalInterventions > 0 ||
        tenantCumulative.totalPhotos > 0 ||
        tenantCumulative.totalAnomaliesResolved > 0) && (
        <section
          data-testid="tenant-cumulative-band"
          className="text-xs text-muted-foreground tabular-nums pt-2"
        >
          Depuis le démarrage :{' '}
          {tenantCumulative.totalInterventions.toLocaleString('fr-FR')} interventions documentées ·{' '}
          {tenantCumulative.totalPhotos.toLocaleString('fr-FR')} photos ·{' '}
          {tenantCumulative.totalAnomaliesResolved.toLocaleString('fr-FR')} incidents traités
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
