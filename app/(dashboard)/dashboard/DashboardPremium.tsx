import Link from 'next/link'
import { Sun, BookOpen, Plus, Building2, CheckSquare, ChevronRight } from 'lucide-react'
import type { VisitImpact } from '@/lib/knowledge/site-events'
import type { UpcomingDashboardItem } from '@/lib/db/upcoming-items'
import type { SiteDashboardItem } from '@/lib/db/sites-dashboard'
import type { LivingASavoirCard } from '@/lib/db/handover'
import type { NowDashboardItem, NowDashboardSummary } from '@/lib/db/now-dashboard'
import type { MemoryReview } from '@/lib/knowledge/memory-review'
import type { DashboardDeadlineToPlan } from '@/lib/db/dashboard-deadlines'
import type { SiteActionRow } from '@/lib/db/site-actions'
import type { OrgLabels } from '@/components/dashboard/OrgBadge'
import type { OrganizationIdentityMap } from '@/lib/db/organisations'
import type { MemorySignal } from '@/lib/memory/signals/operational-contract'
import type { AttentionCard } from '@/lib/situations/attention/types'
import type { NowCard } from '@/lib/situations/now/types'
import { sortAttentionCards } from '@/lib/situations/attention/project'
import { PromiseActions } from './PromiseActions'

type Props = {
  firstName: string
  orgNames: string[]
  attentionCards: AttentionCard[]
  nowCards: NowCard[]
  visit: VisitImpact
  upcoming: UpcomingDashboardItem[]
  sites: SiteDashboardItem[]
  aSavoir: LivingASavoirCard[]
  orgLabels: OrgLabels
  organizationMap: OrganizationIdentityMap
  now: { items: NowDashboardItem[]; summary: NowDashboardSummary; actions: SiteActionRow[] }
  nowSignals: MemorySignal[]
  visitReviews: Record<string, MemoryReview>
  deadlinesToPlan: DashboardDeadlineToPlan[]
}

function livingPhrase(count: number): string {
  if (count === 0) return 'Tout est sous contrôle aujourd\'hui.'
  if (count === 1) return 'Un sujet demande votre attention.'
  return `${count} sujets demandent votre attention.`
}

function familyLabel(card: AttentionCard): string {
  if (card.subject !== null) {
    return card.tone === 'red' ? 'PROMESSE EN RETARD' : 'PROMESSE À CONFIRMER'
  }
  switch (card.icon) {
    case 'calendar': return card.tone === 'red' ? 'ACTION EN RETARD' : 'PLANIFICATION'
    case 'document': return 'DÉBRIEF ATTENDU'
    case 'warning': return card.tone === 'red' ? 'RÉSERVE CRITIQUE' : 'RÉSERVE OUVERTE'
    default: return 'À TRAITER'
  }
}

const FAMILY_COLORS: Record<AttentionCard['tone'], string> = {
  red: 'text-[#dc2626] bg-[#fef2f2]',
  amber: 'text-[#d97706] bg-[#fffbeb]',
  neutral: 'text-[#4973dd] bg-[#eef4ff]',
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Pacific/Noumea',
  }).format(new Date(iso))
}

export function DashboardPremium({ firstName, attentionCards, visit, upcoming, sites }: Props) {
  const sorted = sortAttentionCards(attentionCards)
  const primarySiteId = visit.sites[0]?.siteId ?? null
  const primarySite = primarySiteId ? (sites.find((s) => s.id === primarySiteId) ?? null) : null
  const todaySiteCount = upcoming.filter((i) => i.isToday && i.siteId === primarySiteId).length
  const nextItems = upcoming.filter((i) => !i.isToday)
  const urgentCount = attentionCards.filter((c) => c.tone === 'red').length

  return (
    <div className="min-h-screen bg-[#f4f6fb]">
      <div className="mx-auto max-w-lg pt-2">

        {/* ── Accueil vivant ───────────────────────────────── */}
        <div className="mb-3 px-1">
          <p className="text-base font-semibold text-[#101a35]">Bonjour {firstName} 👋</p>
          <p className="mt-0.5 text-sm text-[#65718b]">{livingPhrase(attentionCards.length)}</p>
        </div>

        {/* ── Bannière attention ────────────────────────────── */}
        {attentionCards.length > 0 && (
          <div className="mb-4 rounded-2xl bg-[#dc2626] px-4 py-3 text-white shadow-sm">
            <p className="font-bold">
              {attentionCards.length} sujet{attentionCards.length > 1 ? 's' : ''} demandent votre attention
            </p>
            <p className="mt-0.5 text-xs text-white/80">
              {urgentCount} urgent{urgentCount !== 1 ? 's' : ''} · {attentionCards.length - urgentCount} à surveiller
            </p>
          </div>
        )}

        {/* ── Carte chantier principal ─────────────────────── */}
        {primarySite && (
          <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#e5eaf3]">
            <div className="h-20 bg-gradient-to-br from-[#b8cef5] to-[#ddeaff]" />
            <div className="px-3 pb-3 pt-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="inline-flex items-center rounded-full bg-[#eef4ff] px-2 py-0.5 text-[10px] font-bold text-[#4973dd]">
                    Chantier actif
                  </span>
                  <h2 className="mt-1 truncate text-base font-bold text-[#101a35]">{primarySite.name}</h2>
                </div>
                <Link
                  href={primarySite.href}
                  className="mt-1 flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs font-semibold text-[#4973dd] hover:underline"
                >
                  Voir le chantier <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <div className="mt-2 grid grid-cols-4 gap-1">
                {[
                  { value: primarySite.activeActionCount, label: 'actions' },
                  { value: todaySiteCount, label: "auj." },
                  { value: primarySite.overdueActionCount, label: 'retard' },
                  { value: primarySite.openReserveCount, label: 'réserves' },
                ].map(({ value, label }) => (
                  <div key={label} className="rounded-lg bg-[#f8fafc] py-1.5 text-center">
                    <p className="text-base font-bold leading-none text-[#101a35]">{value}</p>
                    <p className="mt-0.5 text-[10px] leading-tight text-[#65718b]">{label}</p>
                  </div>
                ))}
              </div>

              <div className="mt-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    primarySite.status === 'critical'
                      ? 'bg-[#fef2f2] text-[#dc2626]'
                      : primarySite.status === 'warning'
                        ? 'bg-[#fffbeb] text-[#d97706]'
                        : 'bg-[#f0fdf4] text-[#16a34a]'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      primarySite.status === 'critical'
                        ? 'bg-[#dc2626]'
                        : primarySite.status === 'warning'
                          ? 'bg-[#f59e0b]'
                          : 'bg-[#22c55e]'
                    }`}
                  />
                  {primarySite.status === 'critical'
                    ? 'Sous tension'
                    : primarySite.status === 'warning'
                      ? 'À surveiller'
                      : 'Stable'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── À traiter en priorité ─────────────────────────── */}
        {sorted.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#e5eaf3]">
            <div className="flex items-center justify-between border-b border-[#f0f3f9] px-4 py-3">
              <h2 className="text-sm font-bold text-[#101a35]">À traiter en priorité</h2>
              <Link href="/actions" className="text-xs font-semibold text-[#4973dd]">
                Voir tout ({sorted.length}) ›
              </Link>
            </div>
            <ul className="divide-y divide-[#f5f7fb]">
              {sorted.slice(0, 5).map((card) => {
                const fulfillResolutions = card.resolutions.filter((r) => r.kind === 'fulfill_promise')
                return (
                  <li key={card.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold tracking-[0.1em] ${FAMILY_COLORS[card.tone]}`}
                      >
                        {familyLabel(card)}
                      </span>
                      <p className="mt-1 text-sm font-semibold leading-snug text-[#17213a]">{card.title}</p>
                      <p className="mt-0.5 text-xs text-[#65718b]">
                        {card.siteLabel}{card.timingLabel ? ` · ${card.timingLabel}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {card.subject && fulfillResolutions.length > 0 ? (
                        <PromiseActions subject={card.subject} resolutions={fulfillResolutions} />
                      ) : card.primaryAction ? (
                        <Link
                          href={card.primaryAction.href}
                          className={`mt-3 inline-flex items-center rounded-xl px-3 py-1.5 text-xs font-semibold ${
                            card.tone === 'red'
                              ? 'bg-[#fef2f2] text-[#dc2626]'
                              : card.tone === 'amber'
                                ? 'bg-[#fffbeb] text-[#d97706]'
                                : 'bg-[#eef4ff] text-[#4973dd]'
                          }`}
                        >
                          Ouvrir
                        </Link>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* ── Prochaines échéances ─────────────────────────── */}
        {nextItems.length > 0 && (
          <div className="mb-4 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-[#e5eaf3]">
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-bold text-[#101a35]">Prochaines échéances</h3>
              <Link href="/planning" className="text-[10px] text-[#4973dd]">Voir tout ›</Link>
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {nextItems.slice(0, 4).map((item) => (
                <li key={`${item.sourceType}:${item.id}`}>
                  <Link href={item.href} className="block hover:opacity-75">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#4973dd]">
                      {shortDate(item.startsAt)}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] font-medium text-[#17213a]">{item.title}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>

      {/* ── Navigation bas de page (fixe) ────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-[#e5eaf3] bg-white px-2 py-3">
        <Link href="/" className="flex flex-col items-center gap-0.5 text-[#4973dd]">
          <Sun className="h-5 w-5" />
          <span className="text-[10px] font-semibold">Aujourd&apos;hui</span>
        </Link>
        <Link href="/journal" className="flex flex-col items-center gap-0.5 text-[#9aa7be]">
          <BookOpen className="h-5 w-5" />
          <span className="text-[10px]">Journal</span>
        </Link>
        <Link
          href="/nouveau"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#16a34a] shadow-md text-white"
          aria-label="Nouveau"
        >
          <Plus className="h-6 w-6" />
        </Link>
        <Link href="/sites" className="flex flex-col items-center gap-0.5 text-[#9aa7be]">
          <Building2 className="h-5 w-5" />
          <span className="text-[10px]">Chantiers</span>
        </Link>
        <Link href="/actions" className="flex flex-col items-center gap-0.5 text-[#9aa7be]">
          <CheckSquare className="h-5 w-5" />
          <span className="text-[10px]">Actions</span>
        </Link>
      </nav>
    </div>
  )
}
