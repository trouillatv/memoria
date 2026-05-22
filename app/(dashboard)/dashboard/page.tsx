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
  Shield,
  Sparkles,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listContracts } from '@/lib/db/contracts'
import { getOnboardingProgress } from '@/lib/db/onboarding'
import {
  getCapitalPreuves,
  listTendersDueSoon,
  getOpenAnomaliesStrict,
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
import { collectMemorySignals } from '@/lib/memory/signals/collect'
import { forSurface } from '@/lib/memory/signals/surface'
import { renderSignal } from '@/lib/memory/signals/render'
import { SIGNAL_REGISTRY } from '@/lib/memory/signals/registry'
import type { MemorySignal } from '@/lib/memory/signals/types'
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
    anomaliesOpen,
    recentAnomalies,
    atRiskEngagements,
    tenantCumulative,
    morningReading,
    recentPassations,
    aSavoir,
    handoverCounts,
    continuity,
    memorySignalsRaw,
  ] = await Promise.all([
    listContracts(),
    getCapitalPreuves(),
    listTendersDueSoon(7),
    getOpenAnomaliesStrict(),
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
    collectMemorySignals(),
  ])

  // Moteur d'états de mémoire (Temps 2) : contextualisé pour le dashboard.
  const memorySignals = forSurface(memorySignalsRaw, {
    surface: 'dashboard',
    perFamilyCap: 3,
  })

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
        memorySignals={memorySignals}
        recentAnomalies={recentAnomalies}
        openAnomaliesCount={anomaliesOpen.total}
        oldOpenAnomaliesCount={anomaliesOpen.oldCount}
        tendersDueSoon={tendersDueSoon}
        atRiskEngagements={atRiskEngagements}
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
              ? 'border-red-300 bg-red-50/60 dark:bg-red-950/20'
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
        ? 'text-red-600'
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
  text: string
  sub?: string
  href?: string
  /** Densité variable : 'normal' = signal individuel, 'compact' = résumé. */
  weight: 'normal' | 'compact'
}

type Family = 'attention' | 'continuite' | 'ao' | 'memoire'

const FAMILY_META: Record<
  Family,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    box: string
    iconColor: string
    /** Couleur du texte des lignes individuelles (poids normal). */
    textColor: string
  }
> = {
  // Anomalies & signaux terrain → ROUGE assumé : demande terrain de Guillaume,
  // cf. [[alertes-doctrine-legere]] (« pivot vers le rouge » pour ce qui mérite
  // attention). Les autres familles restent en teintes douces.
  attention: {
    label: 'Attention opérationnelle',
    icon: AlertTriangle,
    box: 'border-red-300 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20',
    iconColor: 'text-red-600 dark:text-red-300',
    textColor: 'text-red-900 dark:text-red-50',
  },
  continuite: {
    label: 'Continuité',
    icon: ArrowRightLeft,
    box: 'border-amber-200/70 bg-amber-50/30 dark:border-amber-900/30 dark:bg-amber-950/15',
    iconColor: 'text-amber-600',
    textColor: 'text-foreground',
  },
  ao: {
    label: 'Appels d’offres',
    icon: FileText,
    box: 'border-violet-200/70 bg-violet-50/25 dark:border-violet-900/30 dark:bg-violet-950/15',
    iconColor: 'text-violet-600',
    textColor: 'text-foreground',
  },
  memoire: {
    label: 'Mémoire terrain',
    icon: Sparkles,
    box: 'border-sky-200/60 bg-sky-50/20 dark:border-sky-900/30 dark:bg-sky-950/10',
    iconColor: 'text-sky-600',
    textColor: 'text-foreground',
  },
}

function VieDuSysteme({
  memorySignals,
  recentAnomalies,
  openAnomaliesCount,
  oldOpenAnomaliesCount,
  tendersDueSoon,
  atRiskEngagements,
  attentionCount,
  recentPassations,
  aSavoir,
}: {
  memorySignals: MemorySignal[]
  recentAnomalies: RecentAnomalyItem[]
  openAnomaliesCount: number
  oldOpenAnomaliesCount: number
  tendersDueSoon: TenderDueSoonRow[]
  atRiskEngagements: AtRiskEngagement[]
  attentionCount: number
  recentPassations: RecentPassationEntry[]
  aSavoir: LivingASavoirCard[]
}) {
  // Regroupement par FAMILLE connue (pas par importance calculée). Densité
  // variable : signal individuel = ligne normale, résumé = ligne compacte.
  const families: Array<{ family: Family; items: FilItem[] }> = []

  // Signaux du moteur d'états de mémoire (Temps 2), déjà contextualisés par
  // forSurface, injectés EN TÊTE de leur famille. La « vie des lieux » devient
  // progressivement pilotée par le moteur.
  const familyArrays: Record<Family, FilItem[]> = {
    attention: [],
    continuite: [],
    ao: [],
    memoire: [],
  }
  for (const sig of memorySignals) {
    const r = renderSignal(sig)
    familyArrays[SIGNAL_REGISTRY[sig.kind].family].push({
      key: `sig-${sig.kind}-${sig.subjectId}`,
      text: r.text,
      sub: r.detail,
      href: r.href,
      weight: 'normal',
    })
  }

  // — Attention opérationnelle (rouge) —
  const attention: FilItem[] = familyArrays.attention
  for (const a of recentAnomalies.slice(0, 3)) {
    attention.push({
      key: `anomaly-${a.id}`,
      text: anomalyLabel(a.description, a.categoryOther, a.category),
      sub: [a.siteName, relTime(a.createdAt)].filter(Boolean).join(' · ') || undefined,
      href: `/interventions/${a.interventionId}`,
      weight: 'normal',
    })
  }
  for (const e of atRiskEngagements.slice(0, 3)) {
    attention.push({
      key: `eng-${e.engagement_id}`,
      text: `${e.short_label} — ${e.reasonDetail}`,
      sub: e.contract_name,
      href: `/contracts/${e.contract_id}`,
      weight: 'normal',
    })
  }
  if (openAnomaliesCount > 0) {
    const old =
      oldOpenAnomaliesCount > 0 ? ` (dont ${oldOpenAnomaliesCount} depuis plus de 3 jours)` : ''
    attention.push({
      key: 'anomalies-open',
      text: `${openAnomaliesCount} anomalie${openAnomaliesCount > 1 ? 's' : ''} ouverte${openAnomaliesCount > 1 ? 's' : ''}${old}`,
      weight: 'compact',
    })
  }
  if (attentionCount > 0) {
    attention.push({
      key: 'contracts-attention',
      text: `${attentionCount} contrat${attentionCount > 1 ? 's' : ''} demande${attentionCount > 1 ? 'nt' : ''} attention`,
      href: '/contracts',
      weight: 'compact',
    })
  }
  if (attention.length > 0) families.push({ family: 'attention', items: attention })

  // — Continuité (ambre) —
  const continuite: FilItem[] = familyArrays.continuite
  for (const p of recentPassations.filter((p) => !p.isArchived).slice(0, 3)) {
    const sub =
      p.status === 'acknowledged'
        ? p.acknowledgedByLabel
          ? `reconnu par ${p.acknowledgedByLabel} · ${relTime(p.acknowledgedAt ?? p.createdAt)}`
          : `reconnu · ${relTime(p.acknowledgedAt ?? p.createdAt)}`
        : p.status === 'shared'
          ? 'attend une reconnaissance'
          : `préparé · ${relTime(p.createdAt)}`
    continuite.push({
      key: `pass-${p.id}`,
      text: p.title,
      sub,
      href: `/handovers/${p.id}`,
      weight: 'normal',
    })
  }
  if (continuite.length > 0) families.push({ family: 'continuite', items: continuite })

  // — Appels d'offres (violet) —
  const ao: FilItem[] = familyArrays.ao
  for (const t of tendersDueSoon.slice(0, 3)) {
    ao.push({
      key: `ao-${t.id}`,
      text: `« ${t.title} » à rendre ${relDays(t.daysUntilDeadline)}`,
      sub: t.client_name ?? undefined,
      href: `/tenders/${t.id}`,
      weight: 'normal',
    })
  }
  if (ao.length > 0) families.push({ family: 'ao', items: ao })

  // — Mémoire terrain (bleu doux) —
  const memoire: FilItem[] = familyArrays.memoire
  for (const c of aSavoir.slice(0, 3)) {
    memoire.push({
      key: `asavoir-${c.id}`,
      text: c.body,
      sub: `${c.site_name} · noté ${relTime(c.notedAt)}`,
      href: `/sites/${c.site_id}`,
      weight: 'normal',
    })
  }
  if (memoire.length > 0) families.push({ family: 'memoire', items: memoire })

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Vie des lieux</h2>
      {families.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Rien de notable dans la vie des lieux aujourd&apos;hui.
        </p>
      ) : (
        <div className="space-y-3">
          {families.map(({ family, items }) => {
            const meta = FAMILY_META[family]
            return (
              <div key={family} className={`rounded-lg border ${meta.box}`}>
                <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-1">
                  <meta.icon className={`h-3.5 w-3.5 ${meta.iconColor}`} />
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {meta.label}
                  </span>
                </div>
                <ul className="divide-y divide-border/40">
                  {items.map((it) => {
                    const inner = (
                      <div className="px-4 py-2">
                        <p
                          className={
                            it.weight === 'compact'
                              ? 'text-xs text-muted-foreground'
                              : `text-sm leading-snug ${meta.textColor}`
                          }
                        >
                          {it.text}
                        </p>
                        {it.sub && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">{it.sub}</p>
                        )}
                      </div>
                    )
                    return (
                      <li key={it.key}>
                        {it.href ? (
                          <Link
                            href={it.href}
                            className="block hover:bg-background/50 transition-colors"
                          >
                            {inner}
                          </Link>
                        ) : (
                          inner
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
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
