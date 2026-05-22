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
  MapPin,
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
  getAOSnapshot,
  listTendersDueSoon,
  getOpenAnomaliesStats,
  getAtRiskEngagements,
  getTenantCumulativeStats,
  getContractSummaries,
  type TenderDueSoonRow,
  type AtRiskEngagement,
} from '@/lib/db/dashboard'
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
    aoSnapshot,
    tendersDueSoon,
    anomaliesStats,
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
    getAOSnapshot(),
    listTendersDueSoon(7),
    getOpenAnomaliesStats(),
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
        urgentPassations={continuity.counts.j7}
        sharedAwaitingAck={handoverCounts.shared}
        continuityEnabled={continuityEnabled}
      />

      <VieDuSysteme
        tendersDueSoon={tendersDueSoon}
        atRiskEngagements={atRiskEngagements}
        oldAnomaliesCount={anomaliesStats.oldCount}
        attentionCount={attentionCount}
        recentPassations={recentPassations}
        aSavoir={aSavoir}
      />

      <BarreVolumes
        interventions={tenantCumulative.totalInterventions}
        preuves={capital.totalPhotos}
        contrats={capital.totalContractsActive}
        ao={aoSnapshot.activeCount}
        anomalies={anomaliesStats.total}
      />

      <NavContextuelle continuityEnabled={continuityEnabled} />
    </div>
  )
}

// ----------------------------------------------------------------------------
// 1. HERO unique — « Mémoire active ce matin »
// ----------------------------------------------------------------------------

interface HeroSignal {
  tone: 'continuity' | 'ao' | 'memory'
  title: string
  body?: string
  href?: string
  linkLabel?: string
}

function Hero({
  morningReading,
  tendersDueSoon,
  urgentPassations,
  sharedAwaitingAck,
  continuityEnabled,
}: {
  morningReading: TenantMorningReading
  tendersDueSoon: TenderDueSoonRow[]
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

  const primary = signals[0] ?? null
  const secondary = signals[1] ?? null

  return (
    <section
      aria-label="Mémoire active ce matin"
      className={`rounded-xl border p-5 sm:p-6 ${
        primary
          ? primary.tone === 'continuity'
            ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20'
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
    signal.tone === 'continuity' ? ArrowRightLeft : signal.tone === 'ao' ? FileText : Sparkles
  const iconColor =
    signal.tone === 'continuity'
      ? 'text-amber-600'
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
  tendersDueSoon,
  atRiskEngagements,
  oldAnomaliesCount,
  attentionCount,
  recentPassations,
  aSavoir,
}: {
  tendersDueSoon: TenderDueSoonRow[]
  atRiskEngagements: AtRiskEngagement[]
  oldAnomaliesCount: number
  attentionCount: number
  recentPassations: RecentPassationEntry[]
  aSavoir: LivingASavoirCard[]
}) {
  const items: FilItem[] = []

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
// 3. BARRE basse — volumes en une ligne (jamais des cartes KPI)
// ----------------------------------------------------------------------------

function BarreVolumes({
  interventions,
  preuves,
  contrats,
  ao,
  anomalies,
}: {
  interventions: number
  preuves: number
  contrats: number
  ao: number
  anomalies: number
}) {
  const fmt = (n: number) => n.toLocaleString('fr-FR')
  return (
    <p className="text-xs text-muted-foreground tabular-nums pt-1">
      {fmt(interventions)} interventions · {fmt(preuves)} preuves · {fmt(contrats)} contrats ·{' '}
      {fmt(ao)} AO · {fmt(anomalies)} anomalies
    </p>
  )
}

// ----------------------------------------------------------------------------
// 4. NAVIGATION contextuelle — le dashboard POINTE, ne refait pas
// ----------------------------------------------------------------------------

function NavContextuelle({ continuityEnabled }: { continuityEnabled: boolean }) {
  const links: Array<{ href: string; label: string }> = [
    { href: '/handovers', label: 'Passages de témoin' },
    ...(continuityEnabled ? [{ href: '/continuite', label: 'Continuité' }] : []),
    { href: '/tenders', label: 'Appels d’offres' },
    { href: '/sites', label: 'Sites' },
    { href: '/contracts', label: 'Contrats' },
    { href: '/documents', label: 'Bibliothèque' },
  ]
  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-sm">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {l.label} →
        </Link>
      ))}
      <Link
        href="/litige"
        data-testid="dashboard-litige-link"
        className="ml-auto inline-flex items-center gap-1.5 text-amber-800/80 hover:text-amber-900 transition-colors"
      >
        <Shield className="h-3.5 w-3.5" />
        Préparer ma défense
      </Link>
    </nav>
  )
}
