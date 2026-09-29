import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
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
import type { AttentionCard } from '@/lib/situations/attention/types'
import type { HomeHeroDelta } from '@/lib/documents/home-hero-delta'
import { EntityLogo } from '@/components/ui/EntityLogo'
import { SituationAttentionCard } from './SituationAttentionCard'

type Props = {
  firstName: string
  orgNames: string[]
  attentionCards: AttentionCard[]
  upcoming: UpcomingDashboardItem[]
  sites: SiteDashboardItem[]
  activeSiteId: string | null
  // Pré-rendus par page.tsx (Async Server Component + Suspense key={activeSiteId}) :
  // la zone chantier-dépendante (Hero + mémoire) streame indépendamment du tier léger
  // ci-dessous, jamais un blocage du rendu initial de la page (cf. fix Suspense Home V2).
  heroSlot: ReactNode
  memorySlot: ReactNode
  orgLabels: OrgLabels
  organizationMap: OrganizationIdentityMap
  deadlinesToPlan: DashboardDeadlineToPlan[]
}

const surface = 'rounded-[24px] border border-[#e5eaf3] bg-white shadow-[0_10px_35px_rgba(23,39,74,0.045)]'

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
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
        <EntityLogo src={site.organization.logoUrl} label={site.organization.name} size="xl" />
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight text-[#101a35] sm:text-2xl">{site.name}</h2>
          <p className="mt-1 text-xs text-[#65718b]">
            {heroDelta ? `Dernier PV intégré : ${new Date(heroDelta.toEffectiveDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Aucun PV intégré'}
            {' · '}{site.pvCount} PV analysé{site.pvCount > 1 ? 's' : ''}
            {' · '}{site.subjectCount} sujet{site.subjectCount > 1 ? 's' : ''} suivi{site.subjectCount > 1 ? 's' : ''}
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
    { label: 'retard', value: site.overdueActionCount },
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
          <EntityLogo src={site.organization.logoUrl} label={site.organization.name} size="lg" />
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

function ChantierSelector({ sites, activeSiteId }: { sites: SiteDashboardItem[]; activeSiteId: string | null }) {
  // Présentation uniquement : le chantier actif toujours en tête du carrousel ;
  // le reste conserve l'ordre métier déjà trié par getSitesDashboard (urgence/
  // activité) — aucun nouveau tri, aucun tracking de consultation (lot UX polish).
  const orderedSites = activeSiteId
    ? [...sites.filter((s) => s.id === activeSiteId), ...sites.filter((s) => s.id !== activeSiteId)]
    : sites
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
 * Choix déterministe du premier élément à mettre en avant : préfère un item
 * décision/connaissance/vigilance à un simple intervenant, sans jamais retrier
 * ni recalculer `getMemoryReview` — uniquement un choix de présentation parmi
 * les items déjà retournés.
 */
function pickHighlightedMemoryItem(review: MemoryReview) {
  return review.confirmed.find((c) => c.group !== 'Intervenants') ?? review.confirmed[0] ?? null
}

export function MemorySouvient({ site, review }: { site: SiteDashboardItem | null; review: MemoryReview }) {
  const item = pickHighlightedMemoryItem(review)
  return (
    <section className={`${surface} p-5 sm:p-6`}>
      <div className="flex items-center gap-2 text-[#26a67b]"><Sparkles className="h-4 w-4" /><h2 className="text-xs font-bold uppercase tracking-[0.14em]">Mémoire du chantier</h2></div>
      <p className="mt-1 text-xs text-[#7b879d]">Ce que MemorIA sait déjà de ce chantier.</p>
      {!site ? (
        <p className="mt-4 text-sm italic text-[#73809a]">Aucun chantier actif.</p>
      ) : !item ? (
        <p className="mt-4 text-sm italic text-[#73809a]">Aucun élément de mémoire utile mis en avant pour ce chantier pour le moment.</p>
      ) : (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7b879d]">{item.group}</p>
          {item.href ? (
            <Link href={item.href} className="mt-1 block text-sm font-medium text-[#17213a] hover:text-[#1463e8]">{item.title}</Link>
          ) : (
            <p className="mt-1 text-sm font-medium text-[#17213a]">{item.title}</p>
          )}
          {item.nature && <p className="mt-1 text-xs text-[#65718b]">{item.nature}</p>}
        </div>
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

const ATTENTION_BADGE: Record<AttentionCard['tone'], string> = {
  red: 'En retard',
  amber: 'À revoir',
  neutral: 'À traiter',
}
const ATTENTION_BADGE_CLASS: Record<AttentionCard['tone'], string> = {
  red: 'bg-[#ffe3e5] text-[#e35c66]',
  amber: 'bg-[#fff0d7] text-[#c4872a]',
  neutral: 'bg-[#eef4ff] text-[#4973dd]',
}

function AttentionSection({ cards }: { cards: AttentionCard[] }) {
  // `cards` arrive déjà curées et triées par page.tsx (chantier actif d'abord,
  // complété seulement si besoin) — ne jamais re-trier ici au risque de repousser
  // une carte du chantier actif derrière une carte d'un autre chantier.
  return (
    <section className={`${surface} p-5 sm:p-7`}>
      <div className="mb-5 flex items-center gap-2 text-[#f0525f]"><AlertTriangle className="h-4 w-4" /><h2 className="text-xs font-bold uppercase tracking-[0.14em]">Ce qui mérite votre attention</h2></div>
      {cards.length === 0 ? (
        <p className="rounded-2xl bg-[#f3fbf6] px-4 py-5 text-sm text-[#258657]">Tout est en rythme.</p>
      ) : (
        <div className="space-y-2">
          {cards.map((card) => (
            <div key={card.id} className="relative">
              <span className={`absolute right-3 top-3 z-10 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ATTENTION_BADGE_CLASS[card.tone]}`}>{ATTENTION_BADGE[card.tone]}</span>
              <SituationAttentionCard card={card} />
            </div>
          ))}
        </div>
      )}
      <Link href="/actions" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#1463e8] hover:text-[#0c4dbd]">Voir toutes les actions <ArrowRight className="h-3.5 w-3.5" /></Link>
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

export function DashboardPremium({ firstName, orgNames, attentionCards, upcoming, sites, activeSiteId, heroSlot, memorySlot, deadlinesToPlan }: Props) {
  return (
    <div className="min-h-screen w-full bg-[#f8fafc] px-1 pb-12 pt-1 sm:px-2">
      <div className="w-full space-y-5">
        <header className="flex items-end justify-between gap-5 px-1 py-4 sm:px-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[#101a35]">Bonjour {firstName} 👋</h1>
            <p className="mt-1 text-sm text-[#68758d]">Reprenez vos chantiers là où vous les aviez laissés.</p>
            <p className="mt-0.5 text-sm text-[#68758d]">MemorIA vous montre ce qui a évolué, ce qui mérite votre attention et ce qu&apos;il ne faut pas oublier.</p>
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
          <div className="xl:col-span-2"><AttentionSection cards={attentionCards} /></div>
          {memorySlot}
        </div>
        <Agenda items={upcoming} deadlinesToPlan={deadlinesToPlan} />
      </div>
    </div>
  )
}
