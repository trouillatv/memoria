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
import { after } from 'next/server'
import { insertActivityLog } from '@/lib/db/activity-logs'
import {
  AlertTriangle,
  ArrowRightLeft,
  FileText,
  Shield,
  Sparkles,
  ChevronRight,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getOrganizationLabels } from '@/lib/db/organisations'
import { OrgBadge, orgLabelOf, type OrgLabels } from '@/components/dashboard/OrgBadge'
import { getVisitImpact, emptyVisitImpact } from '@/lib/knowledge/site-events'
import { VisitImpactCard } from './VisitImpactCard'
import { getInboxFeed } from '@/lib/db/inbox-feed'
import { DashboardInbox } from './DashboardInbox'
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
  type RecentPassationEntry,
  type LivingASavoirCard,
} from '@/lib/db/handover'
import { collectMemorySignals } from '@/lib/memory/signals/collect'
import { forSurface } from '@/lib/memory/signals/surface'
import { renderSignal } from '@/lib/memory/signals/render'
import { SIGNAL_REGISTRY } from '@/lib/memory/signals/registry'
import type { MemorySignal } from '@/lib/memory/signals/types'
import { getMemoryHeatmap, type HeatmapCell, type MemoryTone } from '@/lib/memory/heatmap'
import { ContinuityWidget } from '@/components/dashboard/ContinuityWidget'
import { WelcomeCard } from './WelcomeCard'
import { DashboardHeader } from './DashboardHeader'
import { AttentionBlock } from './AttentionBlock'
import { getAttentionDigest } from '@/lib/db/attention'
import { StartBar } from './StartBar'
import { NotificationsBar } from './NotificationsBar'
import { getMyUnreadNotifications } from '@/lib/db/notifications'
import { getUpcomingItems } from '@/lib/db/upcoming-items'
import { getSitesDashboard } from '@/lib/db/sites-dashboard'
import { UpcomingPassages } from './UpcomingPassages'
import { WatchedSites } from './WatchedSites'
import { KnowledgeHighlights } from './KnowledgeHighlights'

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

export default async function DashboardPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const onboarding = await getOnboardingProgress()

  // Mode bootstrap : boucle chantier pas encore lancée → welcome card seule.
  if (!onboarding.allDone) {
    return (
      <div className="space-y-6 w-full">
        <WelcomeCard progress={onboarding} />
      </div>
    )
  }

  // M3 — les organisations de l'utilisateur (agrégation multi-org). Sert l'inbox
  // et la résolution des libellés pour les badges.
  const orgIds = await getOrgIdsOfUser()
  // Provenance : résolution uniquement en multi-org — 0 requête en mono-org.
  const rawOrgLabels = orgIds.length > 1 ? await getOrganizationLabels(orgIds) : null
  const orgLabels: OrgLabels = rawOrgLabels
  const orgNames = rawOrgLabels ? Object.values(rawOrgLabels) : []

  // Couche « Nouveau depuis hier » — déclarations QR fraîches depuis last_seen_at.
  const inbox = await getInboxFeed(user.id, orgIds)

  // Socle notifications (mig 159) — surfacé au chargement (bandeau).
  const notifications = await getMyUnreadNotifications()

  const [
    contracts,
    capital,
    tendersDueSoon,
    anomaliesOpen,
    recentAnomalies,
    atRiskEngagements,
    tenantCumulative,
    recentPassations,
    aSavoir,
    memorySignalsRaw,
    heatmap,
    upcoming,
    sitesDashboard,
  ] = await Promise.all([
    listContracts(),
    getCapitalPreuves(),
    listTendersDueSoon(7),
    getOpenAnomaliesStrict(),
    getRecentAnomalies(24),
    getAtRiskEngagements(),
    getTenantCumulativeStats(),
    listRecentPassations(6),
    listLivingASavoir(4),
    collectMemorySignals(),
    getMemoryHeatmap(84),
    getUpcomingItems(orgIds),
    getSitesDashboard(orgIds),
  ])

  // Moteur d'états de mémoire (Temps 2) : contextualisé pour le dashboard.
  const memorySignals = forSurface(memorySignalsRaw, {
    surface: 'dashboard',
    perFamilyCap: 3,
  })

  // Observation produit (Couche B) : log des IMPRESSIONS de signaux (par type,
  // agrégé) — quels signaux apparaissent réellement. Best-effort, non bloquant.
  if (memorySignals.length > 0) {
    const shownKinds = memorySignals.map((s) => s.kind)
    after(() =>
      insertActivityLog({
        userId: user.id,
        entityType: 'signal',
        entityId: null,
        action: 'shown',
        metadata: { kinds: shownKinds },
      }).catch(() => {}),
    )
  }

  // Widgets « ligne mémoire » — condensations du moteur, pas des KPI.
  // État du parc : comptes BRUTS (non plafonnés) par kind.
  const continuityState = {
    stable: memorySignalsRaw.filter((s) => s.kind === 'continuity_stable').length,
    awaiting: memorySignalsRaw.filter((s) => s.kind === 'memory_awaiting').length,
    silence: memorySignalsRaw.filter((s) => s.kind === 'unusual_silence').length,
    instability: memorySignalsRaw.filter((s) => s.kind === 'relay_instability').length,
  }
  // « Dernière mémoire utile » : composée d'artefacts DÉJÀ chargés (0 requête).
  const memoryEvents = buildRecentMemoryEvents({ aSavoir, recentPassations, recentAnomalies })

  const summaryMap = await getContractSummaries(contracts.map((c) => c.id))
  const attentionCount = contracts.filter(
    (c) => c.status === 'active' && summaryMap.get(c.id)?.needsAttention,
  ).length

  const firstName = user.full_name?.split(' ')[0] ?? ''

  // Temps 2 — bloc « Ce qui mérite votre attention » : agrégation déterministe
  // transverse des détecteurs (actions en retard/anciennes, réserves), plafonnée.
  const attention = await getAttentionDigest(5)

  // « Qu'est-ce qui a changé ? » — la première question de la journée. Les nombres
  // viennent de SiteOverview (le read model de la fiche), donc l'accueil et le
  // chantier ne peuvent pas se contredire.
  const todayChanges = await getVisitImpact().catch(() => emptyVisitImpact())

  return (
    <div className="space-y-6 w-full">
      {/* Zone 1 — En-tête personnel. */}
      <DashboardHeader firstName={firstName} orgNames={orgNames} />

      {/* Zone 2 — Attention opérationnelle : le système décide des priorités (5 max). */}
      <AttentionBlock digest={attention} orgLabels={orgLabels} />

      {/* Zone 3 — Prochains passages planifiés (30j). */}
      <UpcomingPassages items={upcoming} />

      {/* Zone 4 — Sites à surveiller : agrégation par site, triée par criticité. */}
      <WatchedSites sites={sitesDashboard} />

      {/* Zone 5 — À savoir : capsules mémoire utiles, une par site. */}
      <KnowledgeHighlights items={aSavoir} />

      {/* Notifications (socle mig 159). */}
      <NotificationsBar notifications={notifications} />

      {/* Barre « Démarrer » sobre & repliable. */}
      <StartBar />

      {/* Modules BTP — conditionnels : silencieux si rien à montrer. */}
      {todayChanges.sites.length > 0 && (
        <VisitImpactCard changes={todayChanges} orgLabels={orgLabels} />
      )}

      {inbox.items.length > 0 && (
        <DashboardInbox feed={inbox} orgLabels={orgLabels} />
      )}

      {/* Ligne mémoire — 3 condensations du moteur (jamais des KPI). */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ContinuityStateWidget state={continuityState} />
        <MemoryHeatmap cells={heatmap} />
        <DerniereMemoireUtile events={memoryEvents} />
      </div>

      {/* Continuité — prévient si une fin de contrat approche. */}
      <ContinuityWidget />

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
        orgLabels={orgLabels}
      />

      {(tenantCumulative.totalInterventions > 0 || capital.totalPhotos > 0) && (
        <ReservoirEtDefense
          interventions={tenantCumulative.totalInterventions}
          preuves={capital.totalPhotos}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Ligne mémoire — Widget « État de la continuité »
// ----------------------------------------------------------------------------

function ContinuityStateWidget({
  state,
}: {
  state: { stable: number; awaiting: number; silence: number; instability: number }
}) {
  const lines: Array<{ tone: 'green' | 'amber' | 'red'; text: string }> = []
  if (state.stable > 0) {
    lines.push({ tone: 'green', text: `Continuité stable sur ${state.stable} lieu${state.stable > 1 ? 'x' : ''}` })
  }
  if (state.awaiting > 0) {
    lines.push({
      tone: 'amber',
      text: `${state.awaiting} passation${state.awaiting > 1 ? 's' : ''} attend${state.awaiting > 1 ? 'ent' : ''} une reconnaissance`,
    })
  }
  if (state.silence > 0) {
    lines.push({ tone: 'red', text: `${state.silence} lieu${state.silence > 1 ? 'x' : ''} en silence inhabituel` })
  }
  if (state.instability > 0) {
    lines.push({ tone: 'red', text: `${state.instability} lieu${state.instability > 1 ? 'x' : ''} en rotation d'équipes` })
  }
  if (lines.length === 0) {
    lines.push({ tone: 'green', text: 'Continuité stable — rien à signaler' })
  }

  const DOT: Record<'green' | 'amber' | 'red', string> = {
    green: 'text-emerald-500',
    amber: 'text-amber-500',
    red: 'text-red-500',
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2.5">
        État de la continuité
      </h2>
      <ul className="space-y-1.5">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start gap-2 text-sm leading-snug">
            <span aria-hidden className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current ${DOT[l.tone]}`} />
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Ligne mémoire — Widget « Dernière mémoire utile »
// ----------------------------------------------------------------------------

interface MemoryEventItem {
  key: string
  text: string
  at: string
  href?: string
  tone: 'memoire' | 'continuite' | 'attention'
}

function buildRecentMemoryEvents(input: {
  aSavoir: LivingASavoirCard[]
  recentPassations: RecentPassationEntry[]
  recentAnomalies: RecentAnomalyItem[]
}): MemoryEventItem[] {
  const out: MemoryEventItem[] = []
  for (const c of input.aSavoir.slice(0, 3)) {
    out.push({ key: `as-${c.id}`, text: `« à savoir » sur ${c.site_name}`, at: c.notedAt, href: `/sites/${c.site_id}`, tone: 'memoire' })
  }
  for (const p of input.recentPassations.filter((p) => p.status === 'acknowledged').slice(0, 2)) {
    out.push({
      key: `pa-${p.id}`,
      text: `Passation reconnue — ${p.title}`,
      at: p.acknowledgedAt ?? p.createdAt,
      href: `/handovers/${p.id}`,
      tone: 'continuite',
    })
  }
  for (const a of input.recentAnomalies.slice(0, 2)) {
    out.push({
      key: `an-${a.id}`,
      text: `Signalement terrain${a.siteName ? ` — ${a.siteName}` : ''}`,
      at: a.createdAt,
      href: a.interventionId ? `/interventions/${a.interventionId}` : undefined,
      tone: 'attention',
    })
  }
  return out.sort((x, y) => (y.at ?? '').localeCompare(x.at ?? '')).slice(0, 4)
}

function DerniereMemoireUtile({ events }: { events: MemoryEventItem[] }) {
  const DOT: Record<MemoryEventItem['tone'], string> = {
    memoire: 'text-sky-500',
    continuite: 'text-amber-500',
    attention: 'text-red-500',
  }
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2.5">
        Dernière mémoire utile
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Rien de récent à signaler.</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((e) => {
            const inner = (
              <span className="flex min-w-0 items-start gap-2 text-sm leading-snug">
                <span aria-hidden className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current ${DOT[e.tone]}`} />
                <span className="min-w-0 flex-1 break-words">
                  <span>{e.text}</span>
                  <span className="text-[11px] text-muted-foreground"> · {relTime(e.at)}</span>
                </span>
              </span>
            )
            return (
              <li key={e.key}>
                {e.href ? (
                  <Link
                    href={e.href}
                    className="group flex min-w-0 items-start gap-1 rounded hover:bg-muted/40 transition-colors -mx-1 px-1"
                  >
                    <span className="min-w-0 flex-1">{inner}</span>
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
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
// Ligne mémoire — Widget « Heatmap mémoire / continuité » (temps mémoriel)
// ----------------------------------------------------------------------------

const HEATMAP_TONE: Record<MemoryTone, string> = {
  green: 'bg-emerald-400/80',
  amber: 'bg-amber-400/80',
  blue: 'bg-sky-400/80',
  red: 'bg-red-400/80',
}
const HEATMAP_LABEL: Record<MemoryTone, string> = {
  green: 'continuité confirmée',
  amber: 'transmission',
  blue: 'mémoire récente',
  red: 'fragilité',
}
const HEATMAP_LEGEND: Array<{ tone: MemoryTone; label: string }> = [
  { tone: 'green', label: 'confirmée' },
  { tone: 'amber', label: 'transmission' },
  { tone: 'blue', label: 'mémoire récente' },
  { tone: 'red', label: 'fragilité' },
]
// Lignes Lun → Dim.
const WEEKDAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function chunkDays<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Index jour de semaine, Lundi=0 … Dimanche=6. */
function weekdayMon(dateIso: string): number {
  return (new Date(dateIso + 'T00:00:00Z').getUTCDay() + 6) % 7
}

function MemoryHeatmap({ cells }: { cells: HeatmapCell[] }) {
  // Alignement calendaire : colonnes = semaines, lignes = Lun→Dim. On comble le
  // début pour que la 1re cellule tombe sur sa bonne ligne de jour.
  const padded: Array<HeatmapCell | null> = []
  if (cells.length > 0) {
    for (let i = 0; i < weekdayMon(cells[0]!.date); i++) padded.push(null)
  }
  padded.push(...cells)
  const weeks = chunkDays(padded, 7)

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2.5">
        Temps mémoriel
      </h2>

      <div className="flex gap-1.5">
        {/* Étiquettes jours (Lun→Dim) */}
        <div className="flex flex-col gap-[3px] pr-0.5">
          {WEEKDAY_LABELS.map((w, i) => (
            <span key={i} className="h-2.5 w-2 text-center text-[8px] leading-[10px] text-muted-foreground/70">
              {w}
            </span>
          ))}
        </div>
        {/* Colonnes = semaines */}
        <div className="flex gap-[3px] overflow-x-auto">
          {weeks.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {Array.from({ length: 7 }).map((_, ri) => {
                const c = col[ri]
                if (!c) return <span key={ri} className="h-2.5 w-2.5" />
                return (
                  <span
                    key={ri}
                    title={c.tone ? `${c.date} · ${HEATMAP_LABEL[c.tone]}` : c.date}
                    className={`h-2.5 w-2.5 rounded-[2px] ${c.tone ? HEATMAP_TONE[c.tone] : 'bg-muted/50'}`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Légende couleurs */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 text-[10px] text-muted-foreground">
        {HEATMAP_LEGEND.map((l) => (
          <span key={l.tone} className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-[2px] ${HEATMAP_TONE[l.tone]}`} />
            {l.label}
          </span>
        ))}
      </div>
    </section>
  )
}

// 2. FIL unique — « Vie du système » (hiérarchisé, pas un activity log)
// ----------------------------------------------------------------------------

interface FilItem {
  key: string
  text: string
  sub?: string
  href?: string
  /** Densité variable : 'normal' = signal individuel, 'compact' = résumé. */
  weight: 'normal' | 'compact'
  /** M3 — provenance PAR ÉLÉMENT (badge multi-org). Absent → pas de badge. */
  organizationId?: string
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
    label: 'Dossiers de démarrage',
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
  orgLabels,
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
  orgLabels: OrgLabels
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
      organizationId: a.organizationId,
    })
  }
  for (const e of atRiskEngagements.slice(0, 3)) {
    attention.push({
      key: `eng-${e.engagement_id}`,
      text: `${e.short_label} — ${e.reasonDetail}`,
      sub: e.contract_name,
      href: `/contracts/${e.contract_id}`,
      weight: 'normal',
      organizationId: e.organizationId,
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
      organizationId: p.organizationId,
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
      organizationId: t.organizationId,
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
      organizationId: c.organizationId,
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
                          <OrgBadge label={orgLabelOf(orgLabels, it.organizationId)} />
                          {orgLabelOf(orgLabels, it.organizationId) ? ' ' : ''}
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
                            className="group flex items-center hover:bg-background/50 transition-colors"
                          >
                            <span className="min-w-0 flex-1">{inner}</span>
                            <ChevronRight className="mr-3 h-4 w-4 shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
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
      {/* « interventions documentées » comptait un objet que plus aucun tenant ne
          crée (0 sur les 5 organisations). Le mot ment sur ce qu'il mesure : ce
          sont les PASSAGES documentés — visites terminées et interventions
          faites. Et « 0 preuves » s'affichait pendant que 50 captures de visite
          existaient. */}
      <p className="text-xs text-muted-foreground tabular-nums">
        Mémoire accumulée : {fmt(interventions)} passage{interventions > 1 ? 's' : ''} documenté{interventions > 1 ? 's' : ''} · {fmt(preuves)} preuve{preuves > 1 ? 's' : ''}
      </p>
      <Link
        href="/litige"
        data-testid="dashboard-litige-link"
        className="inline-flex items-center gap-1.5 text-xs text-amber-800/80 hover:text-amber-900 transition-colors"
      >
        <Shield className="h-3.5 w-3.5" />
        Préparer un dossier
      </Link>
    </div>
  )
}
