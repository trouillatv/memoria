import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Info,
  ListTodo,
  MapPin,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { UpcomingDashboardItem } from '@/lib/db/upcoming-items'
import type { SiteDashboardItem } from '@/lib/db/sites-dashboard'
import type { MemoryReview } from '@/lib/knowledge/memory-review'
import type { DashboardDeadlineToPlan } from '@/lib/db/dashboard-deadlines'
import type { OrgLabels } from '@/components/dashboard/OrgBadge'
import type { OrganizationIdentityMap } from '@/lib/db/organisations'
import type { HomeHeroDelta } from '@/lib/documents/home-hero-delta'
import type { PvSubjectRef } from '@/lib/documents/occurrence-pv-summary'
import type { SiteActionsPilotage } from '@/lib/knowledge/actions-pilotage'
import { buildVisiblePilotageActions } from '@/lib/knowledge/actions-pilotage'
import { EntityLogo } from '@/components/ui/EntityLogo'

type Props = {
  firstName: string
  orgNames: string[]
  upcoming: UpcomingDashboardItem[]
  sites: SiteDashboardItem[]
  activeSiteId: string | null
  // Pré-rendus par page.tsx (Async Server Component + Suspense key={activeSiteId}) :
  // la zone chantier-dépendante (Hero + mémoire + actions) streame indépendamment du
  // tier léger ci-dessous, jamais un blocage du rendu initial de la page (cf. fix
  // Suspense Home V2).
  heroSlot: ReactNode
  memorySlot: ReactNode
  actionsSlot: ReactNode
  orgLabels: OrgLabels
  organizationMap: OrganizationIdentityMap
  deadlinesToPlan: DashboardDeadlineToPlan[]
}

const surface = 'rounded-[24px] border border-[#e5eaf3] bg-white shadow-[0_10px_35px_rgba(23,39,74,0.045)]'

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

function dueDateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function Metric({ icon: Icon, value, label, tone }: { icon: LucideIcon; value: number; label: string; tone: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-[#edf0f6] pb-4 last:border-0 last:pb-0 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4 sm:last:border-r-0">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0"><strong className="block text-2xl font-semibold tracking-tight text-[#101a35]">{value}</strong><span className="text-xs leading-tight text-[#65718b]">{label}</span></span>
    </div>
  )
}

/**
 * Dérivation déterministe, PAS une IA : priorité résolus → évolutions →
 * nouveaux → non mentionnés, cf. mapping figé de home-hero-delta.ts. Aucune
 * fabrication si le chantier n'a pas encore de deuxième PV ou si rien n'a bougé.
 */
function heroTeachings(heroDelta: HomeHeroDelta | null): string[] {
  if (!heroDelta) return []
  if (!heroDelta.metrics) return ['Premier PV intégré — le suivi des évolutions commencera au prochain PV.']
  const m = heroDelta.metrics
  const lines: string[] = []
  if (m.resolus.length > 0) lines.push(`${m.resolus.length} sujet${m.resolus.length > 1 ? 's' : ''} résolu${m.resolus.length > 1 ? 's' : ''} depuis le PV précédent`)
  if (m.evolutions.length > 0) lines.push(`${m.evolutions.length} sujet${m.evolutions.length > 1 ? 's' : ''} en évolution depuis le PV précédent`)
  if (m.nouveaux.length > 0) lines.push(`${m.nouveaux.length} nouveau${m.nouveaux.length > 1 ? 'x' : ''} sujet${m.nouveaux.length > 1 ? 's' : ''} identifié${m.nouveaux.length > 1 ? 's' : ''}`)
  if (m.nonMentionnes.length > 0) lines.push(`${m.nonMentionnes.length} sujet${m.nonMentionnes.length > 1 ? 's' : ''} non mentionné${m.nonMentionnes.length > 1 ? 's' : ''} dans le dernier PV`)
  return lines.length > 0 ? lines.slice(0, 3) : ['Aucune évolution détectée depuis le PV précédent.']
}

/** Section 3 — une colonne du détail du Hero (« NOUVEAUX (3) » + liste), bornée en
 *  hauteur et défilante indépendamment des 3 autres. `muted` = rendu plus neutre
 *  pour « Non mentionnés » (jamais présenté comme un changement au même titre). */
function HeroDetailGroup({
  title,
  items,
  siteId,
  muted,
}: {
  title: string
  items: PvSubjectRef[]
  siteId: string
  muted?: boolean
}) {
  if (items.length === 0) return null
  return (
    <div className={`rounded-xl border p-3 ${muted ? 'border-[#eef1f6] bg-[#fafbfd]' : 'border-[#eef1f6]'}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7b879d]">{title} ({items.length})</p>
      <ul className="mt-1.5 max-h-[220px] space-y-1 overflow-y-auto pr-1">
        {items.map((ref) => (
          <li key={ref.canonicalSubjectId}>
            <Link
              href={`/sites/${siteId}/historique/sujets/${ref.canonicalSubjectId}`}
              className={`text-sm hover:text-[#1463e8] ${muted ? 'text-[#7b879d]' : 'text-[#34415c]'}`}
            >
              {ref.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Hero({ site, heroDelta }: { site: SiteDashboardItem | null; heroDelta: HomeHeroDelta | null }) {
  if (!site) {
    return (
      <section className={`${surface} p-6`}>
        <h2 className="text-lg font-semibold text-[#101a35]">Évolution depuis le PV précédent</h2>
        <p className="mt-4 text-sm text-[#73809a]">Aucun chantier accessible pour le moment.</p>
      </section>
    )
  }
  // Échec technique du calcul : jamais confondu avec un delta réellement vide
  // (cf. mandat FIX #4) — ni compteurs à zéro fabriqués, ni "Aucune évolution
  // détectée" mensonger ; un état d'indisponibilité explicite à la place.
  const metricsFailed = heroDelta?.metricsFailed ?? false
  const teachings = metricsFailed ? [] : heroTeachings(heroDelta)
  const m = metricsFailed ? null : (heroDelta?.metrics ?? null)
  const metrics: Array<{ icon: LucideIcon; value: number; label: string; tone: string }> = [
    { icon: Sparkles, value: m?.nouveaux.length ?? 0, label: 'nouveaux', tone: 'bg-[#eee9ff] text-[#7959d8]' },
    { icon: ArrowRight, value: m?.evolutions.length ?? 0, label: 'évolutions', tone: 'bg-[#fff0e7] text-[#ef8e45]' },
    { icon: CheckCircle2, value: m?.resolus.length ?? 0, label: 'résolus', tone: 'bg-[#e8faf4] text-[#26a67b]' },
    { icon: Info, value: m?.nonMentionnes.length ?? 0, label: 'non mentionnés', tone: 'bg-[#f0f3f8] text-[#657493]' },
  ]
  return (
    <section className={`${surface} p-5 sm:p-8`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">Évolution depuis le PV précédent</p>
      <div className="mt-4 flex items-center gap-4">
        <EntityLogo src={site.displayIdentity.logoUrl} label={site.displayIdentity.label} size="xl" />
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight text-[#101a35] sm:text-2xl">{site.name}</h2>
          {/* FIX 1 (review ChatGPT/Vincent SHA 40a4ba65) — `site.subjectCount` (population
              proposition/thread STI, read-model cartes) et le delta ci-dessous (population
              canonicale proposition UNION canonical_subject_occurrence, `getPvDelta`) sont
              deux read-models distincts et non comparables : ne jamais les juxtaposer ici. */}
          <p className="mt-1 text-xs text-[#65718b]">
            {heroDelta ? `Dernier PV intégré : ${new Date(heroDelta.toEffectiveDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Aucun PV intégré'}
            {' · '}{site.pvCount} PV analysé{site.pvCount > 1 ? 's' : ''}
          </p>
        </div>
      </div>
      {metricsFailed ? (
        <p className="mt-7 text-sm text-[#b4553f]" role="status">
          Synthèse temporairement indisponible — réessayez plus tard.
        </p>
      ) : (
        <>
          <div className="mt-7 grid gap-5 sm:grid-cols-4">{metrics.map((metric) => <Metric key={metric.label} {...metric} />)}</div>
          {teachings.length > 0 && (
            <ul className="mt-6 space-y-2">
              {teachings.map((line) => (
                <li key={line} className="flex items-start gap-2 text-sm text-[#34415c]">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7857d4]" />{line}
                </li>
              ))}
            </ul>
          )}
          {m && (m.nouveaux.length > 0 || m.evolutions.length > 0 || m.resolus.length > 0 || m.nonMentionnes.length > 0) && (
            <div className="mt-6 border-t border-[#edf0f6] pt-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">Détail des changements</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <HeroDetailGroup title="Nouveaux" items={m.nouveaux} siteId={site.id} />
                <HeroDetailGroup title="Évolutions" items={m.evolutions} siteId={site.id} />
                <HeroDetailGroup title="Résolus" items={m.resolus} siteId={site.id} />
                <HeroDetailGroup title="Non mentionnés" items={m.nonMentionnes} siteId={site.id} muted />
              </div>
            </div>
          )}
        </>
      )}
      <Link
        href={`/sites/${site.id}/historique?view=avant-apres`}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#1463e8] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#0c4dbd]"
      >
        Voir ce qui a changé <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  )
}

/** Repli honnête pendant le chargement du tier lourd — jamais les chiffres de l'ancien chantier affiché. */
export function HeroSkeleton() {
  return (
    <section className={`${surface} p-5 sm:p-8`} aria-busy="true" aria-label="Évolution en cours de chargement">
      <div className="h-3 w-48 animate-pulse rounded bg-[#eef1f6]" />
      <div className="mt-4 flex items-center gap-4">
        <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-[#eef1f6]" />
        <div className="h-6 w-40 animate-pulse rounded bg-[#eef1f6]" />
      </div>
      <div className="mt-7 grid gap-5 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-[#f3f5f9]" />)}
      </div>
    </section>
  )
}

function ChantierCard({ site, isActive }: { site: SiteDashboardItem; isActive: boolean }) {
  const counters = [
    { label: 'actions', value: site.activeActionCount },
    { label: 'points', value: site.pointCount },
    { label: 'réserves', value: site.openReserveCount },
  ]
  return (
    <div className={`relative h-full rounded-2xl border p-4 transition-colors ${isActive ? 'border-[#3c6fe0] bg-[#f5f8ff]' : 'border-[#e8edf5] bg-white hover:border-[#cbd9f7]'}`}>
      <Link
        href={`/dashboard?chantier=${site.id}`}
        scroll={false}
        aria-current={isActive ? 'true' : undefined}
        className="absolute inset-0 z-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3c6fe0]"
      >
        <span className="sr-only">Sélectionner {site.name}</span>
      </Link>
      {/* Surface décorative : pointer-events-none pour laisser le clic traverser vers le
          Link plein-carte ci-dessus — seul "Ouvrir le chantier" (hors de ce bloc) reste
          indépendamment cliquable, cf. fix carte-cliquable Home V2. */}
      <div className="relative z-10 pointer-events-none">
        <div className="flex min-w-0 items-center gap-3">
          <EntityLogo src={site.displayIdentity.logoUrl} label={site.displayIdentity.label} size="lg" />
          <div className="min-w-0">
            <strong className="block truncate text-sm font-bold text-[#17213a]">{site.name}</strong>
            <span className="block truncate text-[11px] text-[#7b879d]">{site.pvCount} PV · {site.subjectCount} sujets suivis</span>
          </div>
        </div>
        <p className="mt-2 truncate text-[11px] text-[#7b879d]">
          {site.lastActivityAt ? `Dernière activité : ${dateLabel(site.lastActivityAt)}` : 'Aucune activité récente'}
        </p>
        <div className="mt-3 flex gap-1.5">
          {counters.map((c) => (
            <div key={c.label} className="min-w-0 flex-1 overflow-hidden rounded-lg bg-white/70 px-1.5 py-1.5 text-center">
              <strong className="block truncate text-sm font-semibold tabular-nums text-[#17213a]">{c.value}</strong>
              <span className="block truncate text-[8px] font-medium uppercase tracking-wide text-[#8b96aa]">{c.label}</span>
            </div>
          ))}
        </div>
      </div>
      <Link href={site.href} className="relative z-10 mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1463e8] hover:text-[#0c4dbd]">
        Ouvrir le chantier <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}

/**
 * Tri de présentation par récence — FIX RECENCE CARROUSEL. `lastActivityAt`
 * existant uniquement (aucun nouveau tracking, aucune notion `lastViewed`) :
 * DESC, `null` toujours en dernier, tie-break déterministe par nom.
 */
function compareByRecency(a: SiteDashboardItem, b: SiteDashboardItem): number {
  if (a.lastActivityAt && !b.lastActivityAt) return -1
  if (!a.lastActivityAt && b.lastActivityAt) return 1
  if (a.lastActivityAt && b.lastActivityAt && a.lastActivityAt !== b.lastActivityAt) {
    return a.lastActivityAt > b.lastActivityAt ? -1 : 1
  }
  return a.name.localeCompare(b.name, 'fr')
}

function ChantierSelector({ sites, activeSiteId }: { sites: SiteDashboardItem[]; activeSiteId: string | null }) {
  // Présentation uniquement : le chantier actif toujours en tête du carrousel,
  // puis les autres triés par récence réelle (lastActivityAt) — aucun nouveau
  // tri de getSitesDashboard, aucune donnée modifiée, aucun N+1 (le pool est
  // déjà entièrement chargé par page.tsx). Section 1 — TOUS les chantiers
  // accessibles sont affichés, le scroll horizontal gère le volume.
  const rest = sites.filter((s) => s.id !== activeSiteId).sort(compareByRecency)
  const active = activeSiteId ? sites.find((s) => s.id === activeSiteId) : undefined
  const orderedSites = active ? [active, ...rest] : rest
  return (
    <section className={`${surface} p-5 sm:p-6`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">Vos lieux</p>
          <h2 className="mt-2 text-lg font-semibold text-[#101a35]">Vos chantiers</h2>
        </div>
        <MapPin className="h-5 w-5 text-[#5c7bd9]" />
      </div>
      {sites.length === 0 ? (
        <p className="mt-5 text-sm italic text-[#73809a]">Aucun chantier accessible.</p>
      ) : (
        <div role="list" className="-mx-1 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
          {orderedSites.map((site) => (
            <div key={site.id} role="listitem" className="w-[78%] shrink-0 snap-start xs:w-64 sm:w-64 lg:w-72">
              <ChantierCard site={site} isActive={site.id === activeSiteId} />
            </div>
          ))}
        </div>
      )}
      <Link href="/sites" className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8]">Voir tous les chantiers <ArrowRight className="h-3.5 w-3.5" /></Link>
    </section>
  )
}

/**
 * RICHNESS §3 — priorité de présentation des groupes de mémoire, du plus
 * engageant au plus faible : décision > vigilance > connaissance > intervenant.
 * Purement un ordre d'affichage, jamais un recalcul de `getMemoryReview`.
 */
const MEMORY_GROUP_PRIORITY: Record<string, number> = {
  'Décisions': 0,
  'Points de vigilance': 1,
  'Ce que le chantier sait': 2,
  'Intervenants': 3,
}
const memoryGroupRank = (group: string) => MEMORY_GROUP_PRIORITY[group] ?? 99

/** Section 7 — les libellés de groupe sont stockés au pluriel ; forme singulière
 *  pour un compteur à 1, jamais "1 Décisions". */
const MEMORY_GROUP_SINGULAR: Record<string, string> = {
  'Décisions': 'Décision',
  'Points de vigilance': 'Point de vigilance',
  'Intervenants': 'Intervenant',
}
const memoryGroupLabel = (group: string, count: number) => (count > 1 ? group : (MEMORY_GROUP_SINGULAR[group] ?? group))

export type HomeMemoryCounter = { group: string; count: number }
export type HomeMemoryHighlight = { id: string; group: string; title: string; href: string | null; nature: string | null }
export type HomeMemoryGroupBlock = { group: string; items: HomeMemoryHighlight[] }
export type HomeMemorySummary = { counters: HomeMemoryCounter[]; groups: HomeMemoryGroupBlock[] }

/**
 * Présentateur pur (aucun appel réseau/IA, aucune modification de
 * `getMemoryReview`) : synthétise la mémoire déjà chargée du chantier actif en
 * au plus 4 compteurs (uniquement les groupes réellement présents) et TOUS les
 * `review.confirmed`, regroupés par `group` — AUCUNE exclusion (fix review
 * ChatGPT/Vincent SHA 40a4ba65 : les Intervenants n'étaient plus affichés dès
 * qu'un autre groupe existait, contraire à la maquette). Ordre des groupes =
 * `memoryGroupRank`, ordre des items conservé à l'intérieur de chaque groupe.
 */
function buildHomeMemorySummary(review: MemoryReview): HomeMemorySummary {
  const countByGroup = new Map<string, number>()
  for (const item of review.confirmed) {
    countByGroup.set(item.group, (countByGroup.get(item.group) ?? 0) + 1)
  }
  const counters = [...countByGroup.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => memoryGroupRank(a.group) - memoryGroupRank(b.group))
    .slice(0, 4)

  const groupOrder = [...countByGroup.keys()].sort((a, b) => memoryGroupRank(a) - memoryGroupRank(b))
  const groups: HomeMemoryGroupBlock[] = groupOrder.map((group) => ({
    group,
    items: review.confirmed
      .filter((c) => c.group === group)
      .map((item) => ({ id: item.id, group: item.group, title: item.title, href: item.href, nature: item.nature })),
  }))

  return { counters, groups }
}

export function MemorySouvient({ site, review }: { site: SiteDashboardItem | null; review: MemoryReview }) {
  const summary = buildHomeMemorySummary(review)
  return (
    <section className={`${surface} p-5 sm:p-6`}>
      <div className="flex items-center gap-2 text-[#26a67b]"><Sparkles className="h-4 w-4" /><h2 className="text-xs font-bold uppercase tracking-[0.14em]">Mémoire du chantier</h2></div>
      <p className="mt-1 text-xs text-[#7b879d]">Ce que MemorIA sait déjà de ce chantier.</p>
      {!site ? (
        <p className="mt-4 text-sm italic text-[#73809a]">Aucun chantier actif.</p>
      ) : summary.groups.length === 0 ? (
        <p className="mt-4 text-sm italic text-[#73809a]">Aucun élément de mémoire utile mis en avant pour ce chantier pour le moment.</p>
      ) : (
        <>
          {summary.counters.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {summary.counters.map((c) => (
                <span key={c.group} className="rounded-full bg-[#eef4ff] px-2.5 py-1 text-[10px] font-semibold text-[#4973dd]">
                  {c.count} {memoryGroupLabel(c.group, c.count)}
                </span>
              ))}
            </div>
          )}
          <div className="mt-4 max-h-[400px] space-y-4 overflow-y-auto pr-1">
            {summary.groups.map((block) => (
              <div key={block.group}>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7b879d]">{block.group}</p>
                <div className="mt-1.5 space-y-2">
                  {block.items.map((item) => (
                    <div key={item.id}>
                      {item.href ? (
                        <Link href={item.href} className="block text-sm font-medium text-[#17213a] hover:text-[#1463e8]">{item.title}</Link>
                      ) : (
                        <p className="text-sm font-medium text-[#17213a]">{item.title}</p>
                      )}
                      {item.nature && <p className="mt-0.5 text-xs text-[#65718b]">{item.nature}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {site && summary.groups.length > 0 && (
        <Link href={`/sites/${site.id}/memoire`} className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8] hover:text-[#0c4dbd]">
          Voir toute la mémoire <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  )
}

/** Repli honnête pendant le chargement du tier lourd — jamais le contenu de l'ancien chantier. */
export function MemorySouvientSkeleton() {
  return (
    <section className={`${surface} p-5 sm:p-6`} aria-busy="true" aria-label="Mémoire en cours de chargement">
      <div className="flex items-center gap-2 text-[#26a67b]"><Sparkles className="h-4 w-4" /><h2 className="text-xs font-bold uppercase tracking-[0.14em]">Mémoire du chantier</h2></div>
      <p className="mt-1 text-xs text-[#7b879d]">Ce que MemorIA sait déjà de ce chantier.</p>
      <div className="mt-4 h-4 w-3/4 animate-pulse rounded bg-[#eef1f6]" />
    </section>
  )
}

/**
 * Section 6 — « Actions du chantier » : strictement `activeSiteId`-scopé, population
 * EXHAUSTIVE = CBO actifs rattachés à un sujet PLUS `pilotage.unattachedActions`
 * (fix review ChatGPT/Vincent SHA 40a4ba65 — ces dernières étaient invisibles alors
 * que `getSiteActionsPilotage` documente qu'elles ne doivent jamais le devenir),
 * via `buildVisiblePilotageActions` (aucun re-tri ici). Le compteur affiché =
 * `items.length`, la même population réellement rendue — plus `pilotage.kpi.activeCbo`
 * qui excluait les actions non rattachées. `overdueDaysByActionId` vient du pipeline
 * temporel dédié (targetActionId → raw due_date_status → isActionOverdue) calculé
 * côté page.tsx, car `PilotageCbo` ne porte pas `dueDateStatus`.
 */
export function ActionsDuChantier({
  site,
  pilotage,
  lateCount,
  overdueDaysByActionId,
}: {
  site: SiteDashboardItem | null
  pilotage: SiteActionsPilotage
  lateCount: number
  overdueDaysByActionId: Record<string, number>
}) {
  const items = buildVisiblePilotageActions(pilotage)
  return (
    <section className={`${surface} p-5 sm:p-6`}>
      <div className="flex items-center gap-2 text-[#ef8e45]"><ListTodo className="h-4 w-4" /><h2 className="text-xs font-bold uppercase tracking-[0.14em]">Actions du chantier</h2></div>
      <p className="mt-1 text-xs text-[#7b879d]">Ce qui est en cours sur ce chantier.</p>
      {!site ? (
        <p className="mt-4 text-sm italic text-[#73809a]">Aucun chantier actif.</p>
      ) : (
        <>
          <p className="mt-3 text-xs font-medium text-[#65718b]">
            {items.length} action{items.length > 1 ? 's' : ''} · {lateCount} en retard
          </p>
          {items.length === 0 ? (
            <p className="mt-4 text-sm italic text-[#73809a]">Aucune action en cours sur ce chantier.</p>
          ) : (
            <div className="mt-4 max-h-[400px] space-y-2 overflow-y-auto pr-1">
              {items.map(({ subject, cbo }) => {
                const overdueDays = cbo.targetActionId ? overdueDaysByActionId[cbo.targetActionId] : undefined
                return (
                  <Link
                    key={cbo.cboId}
                    href={cbo.targetActionId ? `/sites/${site.id}/actions?actionId=${cbo.targetActionId}` : `/sites/${site.id}/actions`}
                    className="block rounded-xl border border-[#eef1f6] px-3 py-2.5 hover:border-[#cbd9f7]"
                  >
                    <p className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7b879d]">
                      {subject ? subject.label : 'Action non rattachée'}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-medium text-[#17213a]">{cbo.label}</p>
                    {(cbo.dueDate || overdueDays !== undefined) && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {cbo.dueDate && <span className="text-xs text-[#7b879d]">Échéance {dueDateLabel(cbo.dueDate)}</span>}
                        {overdueDays !== undefined && (
                          <span className="rounded-full bg-[#fdecea] px-2 py-0.5 text-[10px] font-semibold text-[#b4553f]">
                            En retard{overdueDays > 0 ? ` de ${overdueDays} j` : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
          <Link href={`/sites/${site.id}/actions`} className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8] hover:text-[#0c4dbd]">
            Voir toutes les actions <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </>
      )}
    </section>
  )
}

/** Repli honnête pendant le chargement du tier lourd — jamais le contenu de l'ancien chantier. */
export function ActionsDuChantierSkeleton() {
  return (
    <section className={`${surface} p-5 sm:p-6`} aria-busy="true" aria-label="Actions en cours de chargement">
      <div className="flex items-center gap-2 text-[#ef8e45]"><ListTodo className="h-4 w-4" /><h2 className="text-xs font-bold uppercase tracking-[0.14em]">Actions du chantier</h2></div>
      <p className="mt-1 text-xs text-[#7b879d]">Ce qui est en cours sur ce chantier.</p>
      <div className="mt-4 h-4 w-3/4 animate-pulse rounded bg-[#eef1f6]" />
    </section>
  )
}

function Agenda({ items, deadlinesToPlan }: { items: UpcomingDashboardItem[]; deadlinesToPlan: DashboardDeadlineToPlan[] }) {
  const nextItem = items[0] ?? null
  const nextDeadline = deadlinesToPlan[0] ?? null
  return (
    <section className={`${surface} p-5 sm:p-6`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6a7892]">À organiser</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#34415c]">
        <span><strong className="font-semibold text-[#101a35]">{items.length}</strong> passage{items.length > 1 ? 's' : ''} à venir</span>
        <span><strong className="font-semibold text-[#101a35]">{deadlinesToPlan.length}</strong> échéance{deadlinesToPlan.length > 1 ? 's' : ''} à planifier</span>
      </div>
      {nextDeadline ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-[#fff9ed] px-3 py-2.5">
          <div className="min-w-0">
            <strong className="block truncate text-xs font-semibold text-[#34415c]">{nextDeadline.title}</strong>
            <span className="block truncate text-[10px] text-[#7b879d]">{nextDeadline.siteName}</span>
          </div>
          <Link href={nextDeadline.href} className="shrink-0 rounded-lg bg-white px-2 py-1 text-[10px] font-semibold text-[#c4872a] ring-1 ring-[#f1d494]">Planifier</Link>
        </div>
      ) : nextItem ? (
        <div className="mt-4 rounded-xl bg-[#f8faff] px-3 py-2.5 text-xs text-[#34415c]">
          <strong className="font-semibold">{nextItem.title}</strong> · {nextItem.siteName} · {nextItem.isToday ? "Aujourd'hui" : dateLabel(nextItem.startsAt)}
        </div>
      ) : (
        <p className="mt-4 text-xs italic text-[#73809a]">Rien à organiser pour le moment.</p>
      )}
      <Link href="/mois" className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8]">Voir le planning complet <ArrowRight className="h-3.5 w-3.5" /></Link>
    </section>
  )
}

export function DashboardPremium({ firstName, orgNames, upcoming, sites, activeSiteId, heroSlot, memorySlot, actionsSlot, deadlinesToPlan }: Props) {
  return (
    <div className="min-h-screen w-full bg-[#f8fafc] px-1 pb-12 pt-1 sm:px-2">
      <div className="w-full space-y-5">
        <header className="flex items-end justify-between gap-5 px-1 py-4 sm:px-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[#101a35]">Bonjour {firstName} 👋</h1>
            <p className="mt-1 text-sm text-[#68758d]">Reprenez vos chantiers là où vous les aviez laissés.</p>
            <p className="mt-0.5 text-sm text-[#68758d]">MemorIA vous montre ce qui a évolué, ce qui est en cours et ce qu&apos;il ne faut pas oublier.</p>
            {orgNames.length > 1 && <p className="mt-3 text-[11px] font-normal text-[#9aa5b8]">{orgNames.join(' · ')}</p>}
          </div>
          <div className="hidden items-center gap-2 text-xs text-[#7a879f] lg:flex">
            <span className="rounded-full border border-[#e2e8f2] bg-white px-4 py-2">Rechercher un chantier, une action, un document…</span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e2e8f2] bg-white"><Info className="h-4 w-4" /></span>
          </div>
        </header>
        <ChantierSelector sites={sites} activeSiteId={activeSiteId} />
        {heroSlot}
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">{actionsSlot}</div>
          {memorySlot}
        </div>
        <Agenda items={upcoming} deadlinesToPlan={deadlinesToPlan} />
      </div>
    </div>
  )
}
