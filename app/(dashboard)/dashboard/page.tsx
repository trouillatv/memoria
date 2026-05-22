// /dashboard — « Collapse » éditorial (Vincent 2026-05-22).
//
// MemorIA n'est pas un dashboard de supervision : c'est un système de
// surgissement contextuel. La page « apparaît au bon moment, puis se retire ».
//
// 4 zones, pas 12 widgets :
//   1. HERO unique « Mémoire active ce matin » — UN message (+1 secondaire max),
//      ou silence vert assumé. Réutilise les RÉSONANCES existantes + états
//      continuité/AO réellement calculables. Aucun signal fabriqué (la
//      récurrence « 3e fois », la résonance AO↔site = moteur de surfaçage,
//      chantier séparé « Temps 2 », pas codé ici).
//   2. FIL unique « Vie du système » — flux hiérarchisé, pas un activity log.
//   3. BARRE basse — volumes en une ligne, jamais des cartes KPI.
//   4. NAVIGATION contextuelle — le dashboard POINTE, ne refait pas.
//
// Doctrine : couleur forte UNIQUEMENT si continuité menacée ou action requise.
// Sujet = la mémoire / le lieu, jamais la performance d'une personne. Pas
// d'impératif (« reconnaître 1 brief ») — du factuel indicatif (« 1 brief
// attend une reconnaissance »).

import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ShieldCheck,
  AlertTriangle,
  ArrowRightLeft,
  FileText,
  Pin,
  CheckCircle2,
  Shield,
  Sparkles,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listContracts } from '@/lib/db/contracts'
import { getOnboardingProgress } from '@/lib/db/onboarding'
import {
  getCapitalPreuves,
  listTendersDueSoon,
  getOpenAnomaliesStats,
  getAtRiskEngagements,
  getTenantCumulativeStats,
  getContractSummaries,
  getRecentAnomalies,
  type TenderDueSoonRow,
  type AtRiskEngagement,
  type RecentAnomalyItem,
} from '@/lib/db/dashboard'
import { anomalyLabel } from '@/lib/anomaly-labels'
import {
  listRecentPassations,
  listLivingASavoir,
  countHandoverBriefsByStatus,
  type RecentPassationEntry,
  type LivingASavoirCard,
} from '@/lib/db/handover'
import { listContinuityRisks } from '@/lib/db/continuity'
import { isContinuityFeatureEnabled } from '@/lib/continuity/access'
import { getTenantTopMorningReading, type TenantMorningReading } from '@/lib/db/site-cockpit'
import { WelcomeCard } from './WelcomeCard'
import { DashboardHeader } from './DashboardHeader'

export const dynamic = 'force-dynamic'

// ----------------------------------------------------------------------------
// Helpers temps
// ----------------------------------------------------------------------------

function relDays(n: number): string {
  if (n < 0) return `en retard de ${-n} jour${-n > 1 ? 's' : ''}`
  if (n === 0) return "aujourd'hui"
  if (n === 1) return 'demain'
  return `dans ${n} jours`
}

function relTime(iso: string | null): string {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 0) return "à l'instant"
  const days = Math.floor(diffMs / 86_400_000)
  if (days <= 0) {
    const hours = Math.floor(diffMs / 3_600_000)
    if (hours <= 0) return "à l'instant"
    return hours === 1 ? 'il y a 1 heure' : `il y a ${hours} heures`
  }
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} jours`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return weeks === 1 ? 'il y a 1 semaine' : `il y a ${weeks} semaines`
  const months = Math.floor(days / 30)
  return months <= 1 ? 'il y a 1 mois' : `il y a ${months} mois`
}

function capitalizeFirst(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s
}

export default async function DashboardPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const onboarding = await getOnboardingProgress()

  // Mode bootstrap : aucun contrat actif → welcome card seule.
  if (!onboarding.hasActiveContract) {
    return (
      <div className="space-y-6 max-w-5xl">
        <WelcomeCard progress={onboarding} />
      </div>
    )
  }

  const continuityEnabled = isContinuityFeatureEnabled()

  const [
    contracts,
    capital,
    tendersDueSoon,
    anomaliesStats,
    recentAnomalies,
    atRiskEngagements,
    tenantCumulative,
    morningReading,
    recentPassations,
    aSavoir,
    handoverCounts,
    continuity,
  ] = await Promise.all([
    listContracts(),
    getCapitalPreuves(),
    listTendersDueSoon(7),
    getOpenAnomaliesStats(),
    getRecentAnomalies(24),
    getAtRiskEngagements(),
    getTenantCumulativeStats(),
    getTenantTopMorningReading(),
    listRecentPassations(6),
    listLivingASavoir(4),
    countHandoverBriefsByStatus(),
    continuityEnabled
      ? listContinuityRisks({ horizonDays: 7, viewerUserId: user.id })
      : Promise.resolve({ entries: [], counts: { j7: 0, j14: 0, j30: 0 } }),
  ])

  const summaryMap = await getContractSummaries(contracts.map((c) => c.id))
  const attentionCount = contracts.filter(
    (c) => c.status === 'active' && summaryMap.get(c.id)?.needsAttention,
  ).length

  const firstName = user.full_name?.split(' ')[0] ?? 'là'
  const active = contracts.filter((c) => c.status === 'active')

  return (
    <div className="space-y-6 max-w-5xl">
      <DashboardHeader
        firstName={firstName}
        activeContractsCount={active.length}
        activeContracts={active.map((c) => ({ id: c.id, name: c.name }))}
      />

      <Hero
        morningReading={morningReading}
        tendersDueSoon={tendersDueSoon}
        recentAnomalies={recentAnomalies}
        urgentPassations={continuity.counts.j7}
        sharedAwaitingAck={handoverCounts.shared}
        continuityEnabled={continuityEnabled}
      />

      <VieDuSysteme
        recentAnomalies={recentAnomalies}
        tendersDueSoon={tendersDueSoon}
        atRiskEngagements={atRiskEngagements}
        oldAnomaliesCount={anomaliesStats.oldCount}
        attentionCount={attentionCount}
        recentPassations={recentPassations}
        aSavoir={aSavoir}
      />

      <ReservoirEtDefense
        interventions={tenantCumulative.totalInterventions}
        preuves={capital.totalPhotos}
      />
    </div>
  )
}

// ----------------------------------------------------------------------------
// 1. HERO unique — « Mémoire active ce matin »
// ----------------------------------------------------------------------------

interface HeroSignal {
  tone: 'continuity' | 'ao' | 'memory' | 'field'
  title: string
  body?: string
  href?: string
  linkLabel?: string
}

function Hero({
  morningReading,
  tendersDueSoon,
  recentAnomalies,
  urgentPassations,
  sharedAwaitingAck,
  continuityEnabled,
}: {
  morningReading: TenantMorningReading
  tendersDueSoon: TenderDueSoonRow[]
  recentAnomalies: RecentAnomalyItem[]
  urgentPassations: number
  sharedAwaitingAck: number
  continuityEnabled: boolean
}) {
  const signals: HeroSignal[] = []

  // Continuité (état le plus critique : rupture de mémoire) — gated.
  if (continuityEnabled && (urgentPassations > 0 || sharedAwaitingAck > 0)) {
    const parts: string[] = []
    if (urgentPassations > 0) {
      parts.push(
        `${urgentPassations} passation${urgentPassations > 1 ? 's' : ''} à préparer cette semaine`,
      )
    }
    if (sharedAwaitingAck > 0) {
      parts.push(
        `${sharedAwaitingAck} passation${sharedAwaitingAck > 1 ? 's' : ''} en attente de reconnaissance`,
      )
    }
    signals.push({
      tone: 'continuity',
      title: capitalizeFirst(parts.join(' · ') + '.'),
      href: '/continuite',
      linkLabel: 'Voir la continuité',
    })
  }

  // AO daté (signal actionnable).
  if (tendersDueSoon.length > 0) {
    const nearest = tendersDueSoon.reduce((a, b) =>
      b.daysUntilDeadline < a.daysUntilDeadline ? b : a,
    )
    signals.push({
      tone: 'ao',
      title:
        tendersDueSoon.length === 1
          ? `Un appel d'offres doit être remis ${relDays(nearest.daysUntilDeadline)}.`
          : `${tendersDueSoon.length} appels d'offres à rendre cette semaine.`,
      body:
        tendersDueSoon.length === 1
          ? nearest.client_name
            ? `« ${nearest.title} » — ${nearest.client_name}`
            : `« ${nearest.title} »`
          : `Le plus proche : « ${nearest.title} » ${relDays(nearest.daysUntilDeadline)}.`,
      href: '/tenders',
      linkLabel: 'Voir les AO',
    })
  }

  // Mémoire terrain (résonance existante — jamais inventée).
  if (morningReading.reading) {
    const fragments =
      morningReading.reading.fragments && morningReading.reading.fragments.length > 0
        ? ' ' + morningReading.reading.fragments.slice(0, 4).join(' · ')
        : ''
    signals.push({
      tone: 'memory',
      title: morningReading.reading.text + fragments,
      href: morningReading.siteId ? `/sites/${morningReading.siteId}` : undefined,
      linkLabel: morningReading.siteName ? `— ${morningReading.siteName}` : undefined,
    })
  }

  // Signalements terrain frais (24h) — en dernier dans le hero (souvent
  // nombreux) pour ne pas recréer l'alarme « 17 anomalies » : le détail vit
  // dans le fil. Mais leur présence empêche un faux « les lieux sont calmes ».
  if (recentAnomalies.length > 0) {
    const n = recentAnomalies.length
    const first = recentAnomalies[0]!
    signals.push({
      tone: 'field',
      title: `${n} signalement${n > 1 ? 's' : ''} terrain ces dernières 24h.`,
      body:
        n === 1
          ? anomalyLabel(first.description, first.categoryOther, first.category) +
            (first.siteName ? ` — ${first.siteName}` : '')
          : undefined,
      href: n === 1 ? `/interventions/${first.interventionId}` : undefined,
      linkLabel: n === 1 ? 'Voir le signalement' : undefined,
    })
  }

  const primary = signals[0] ?? null
  const secondary = signals[1] ?? null

  return (
    <section
      aria-label="Mémoire active ce matin"
      className={`rounded-xl border p-5 sm:p-6 ${
        primary
          ? primary.tone === 'continuity'
            ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20'
            : primary.tone === 'field'
              ? 'border-rose-200 bg-rose-50/40 dark:bg-rose-950/20'
              : primary.tone === 'ao'
                ? 'border-brand-200 bg-brand-50/40 dark:bg-brand-950/20'
                : 'border-foreground/10 bg-[#fafaf7] dark:bg-muted/20'
          : 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/15'
      }`}
    >
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">
        Mémoire active ce matin
      </h2>

      {!primary ? (
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-base sm:text-lg leading-snug">
              Les lieux sont calmes ce matin.
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Aucune continuité fragile détectée, aucune échéance proche.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <HeroLine signal={primary} primary />
          {secondary && (
            <div className="pt-2 border-t border-border/60">
              <HeroLine signal={secondary} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function HeroLine({ signal, primary }: { signal: HeroSignal; primary?: boolean }) {
  const Icon =
    signal.tone === 'continuity'
      ? ArrowRightLeft
      : signal.tone === 'field'
        ? AlertTriangle
        : signal.tone === 'ao'
          ? FileText
          : Sparkles
  const iconColor =
    signal.tone === 'continuity'
      ? 'text-amber-600'
      : signal.tone === 'field'
        ? 'text-rose-600'
        : signal.tone === 'ao'
          ? 'text-brand-600'
          : 'text-muted-foreground'

  return (
    <div className="flex items-start gap-3">
      <Icon className={`${primary ? 'h-5 w-5' : 'h-4 w-4'} shrink-0 mt-0.5 ${iconColor}`} />
      <div className="min-w-0 flex-1">
        <p className={primary ? 'text-base sm:text-lg leading-snug' : 'text-sm leading-snug'}>
          {signal.title}
          {signal.tone === 'memory' && signal.href && signal.linkLabel && (
            <Link
              href={signal.href}
              className="text-sm text-muted-foreground hover:text-foreground ml-2"
            >
              {signal.linkLabel}
            </Link>
          )}
        </p>
        {signal.body && <p className="text-sm text-muted-foreground mt-0.5">{signal.body}</p>}
        {signal.tone !== 'memory' && signal.href && signal.linkLabel && (
          <Link
            href={signal.href}
            className="text-sm font-medium underline underline-offset-2 hover:no-underline mt-1 inline-block"
          >
            {signal.linkLabel}
          </Link>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// 2. FIL unique — « Vie du système » (hiérarchisé, pas un activity log)
// ----------------------------------------------------------------------------

interface FilItem {
  key: string
  icon: React.ComponentType<{ className?: string }>
  text: string
  sub?: string
  href?: string
  accent?: boolean
}

function VieDuSysteme({
  recentAnomalies,
  tendersDueSoon,
  atRiskEngagements,
  oldAnomaliesCount,
  attentionCount,
  recentPassations,
  aSavoir,
}: {
  recentAnomalies: RecentAnomalyItem[]
  tendersDueSoon: TenderDueSoonRow[]
  atRiskEngagements: AtRiskEngagement[]
  oldAnomaliesCount: number
  attentionCount: number
  recentPassations: RecentPassationEntry[]
  aSavoir: LivingASavoirCard[]
}) {
  const items: FilItem[] = []

  // Tier 0 — signalements terrain frais (24h) : le lieu vient de parler.
  for (const a of recentAnomalies.slice(0, 3)) {
    items.push({
      key: `anomaly-${a.id}`,
      icon: AlertTriangle,
      text: anomalyLabel(a.description, a.categoryOther, a.category),
      sub: [a.siteName, relTime(a.createdAt)].filter(Boolean).join(' · ') || undefined,
      href: `/interventions/${a.interventionId}`,
      accent: true,
    })
  }

  // Tier 1 — échéances datées (le plus actionnable).
  for (const t of tendersDueSoon.slice(0, 3)) {
    items.push({
      key: `ao-${t.id}`,
      icon: FileText,
      text: `AO « ${t.title} » à rendre ${relDays(t.daysUntilDeadline)}`,
      sub: t.client_name ?? undefined,
      href: `/tenders/${t.id}`,
      accent: t.daysUntilDeadline <= 2,
    })
  }

  // Tier 2 — engagements qui méritent un coup d'œil.
  for (const e of atRiskEngagements.slice(0, 3)) {
    items.push({
      key: `eng-${e.engagement_id}`,
      icon: AlertTriangle,
      text: `${e.short_label} — ${e.reasonDetail}`,
      sub: e.contract_name,
      href: `/contracts/${e.contract_id}`,
    })
  }

  // Tier 2bis — contrats demandant attention (factuel, indicatif).
  if (attentionCount > 0) {
    items.push({
      key: 'contracts-attention',
      icon: AlertTriangle,
      text: `${attentionCount} contrat${attentionCount > 1 ? 's' : ''} demande${attentionCount > 1 ? 'nt' : ''} attention`,
      href: '/contracts',
    })
  }

  // Tier 3 — anomalies qui traînent (>3 jours).
  if (oldAnomaliesCount > 0) {
    items.push({
      key: 'anomalies-old',
      icon: AlertTriangle,
      text: `${oldAnomaliesCount} anomalie${oldAnomaliesCount > 1 ? 's' : ''} ouverte${oldAnomaliesCount > 1 ? 's' : ''} depuis plus de 3 jours`,
    })
  }

  // Tier 4 — vie de la mémoire : passations reconnues / partagées.
  for (const p of recentPassations.filter((p) => !p.isArchived).slice(0, 2)) {
    const sub =
      p.status === 'acknowledged'
        ? p.acknowledgedByLabel
          ? `reconnu par ${p.acknowledgedByLabel} · ${relTime(p.acknowledgedAt ?? p.createdAt)}`
          : `reconnu · ${relTime(p.acknowledgedAt ?? p.createdAt)}`
        : p.status === 'shared'
          ? '1 passation attend une reconnaissance'
          : `préparé · ${relTime(p.createdAt)}`
    items.push({
      key: `pass-${p.id}`,
      icon: p.status === 'acknowledged' ? CheckCircle2 : ArrowRightLeft,
      text: p.title,
      sub,
      href: `/handovers/${p.id}`,
    })
  }

  // Tier 5 — « à savoir » vivant (mémoire condensée, sujet = le lieu).
  for (const c of aSavoir.slice(0, 2)) {
    items.push({
      key: `asavoir-${c.id}`,
      icon: Pin,
      text: c.body,
      sub: `${c.site_name} · noté ${relTime(c.notedAt)}`,
      href: `/sites/${c.site_id}`,
    })
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Vie des lieux</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Rien de notable dans la vie des lieux aujourd&apos;hui.
        </p>
      ) : (
        <ul className="rounded-lg border bg-card divide-y">
          {items.slice(0, 7).map((it) => {
            const inner = (
              <div className="flex items-start gap-3 px-4 py-2.5">
                <it.icon
                  className={`h-4 w-4 shrink-0 mt-0.5 ${it.accent ? 'text-rose-600' : 'text-muted-foreground'}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">{it.text}</p>
                  {it.sub && <p className="text-[11px] text-muted-foreground mt-0.5">{it.sub}</p>}
                </div>
              </div>
            )
            return (
              <li key={it.key}>
                {it.href ? (
                  <Link href={it.href} className="block hover:bg-muted/40 transition-colors">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ----------------------------------------------------------------------------
// 3. PIED — réservoir de mémoire (le moat « par l'évidence ») + lien défense.
//    Pas de compteurs ERP : contrats / AO / anomalies sont déjà dans le
//    sidebar (nav globale) et dans le fil. On ne garde que ce qui a un sens
//    produit propre : le volume de mémoire/preuve accumulée.
// ----------------------------------------------------------------------------

function ReservoirEtDefense({
  interventions,
  preuves,
}: {
  interventions: number
  preuves: number
}) {
  const fmt = (n: number) => n.toLocaleString('fr-FR')
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-4">
      <p className="text-xs text-muted-foreground tabular-nums">
        Mémoire accumulée : {fmt(interventions)} interventions documentées · {fmt(preuves)} preuves
      </p>
      <Link
        href="/litige"
        data-testid="dashboard-litige-link"
        className="inline-flex items-center gap-1.5 text-xs text-amber-800/80 hover:text-amber-900 transition-colors"
      >
        <Shield className="h-3.5 w-3.5" />
        Préparer ma défense
      </Link>
    </div>
  )
}
