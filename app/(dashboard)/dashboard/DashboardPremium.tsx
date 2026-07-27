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
import { QuickConfirmButton } from './PromiseActions'

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

function ctaLabel(card: AttentionCard): string {
  if (card.icon === 'calendar') return card.tone === 'red' ? 'Ouvrir' : 'Planifier'
  if (card.icon === 'document') return 'Compléter'
  if (card.icon === 'warning') return card.tone === 'red' ? 'Arbitrer' : 'Ouvrir'
  return 'Voir'
}

const CTA_COLORS: Record<AttentionCard['tone'], string> = {
  red: 'bg-[#fef2f2] text-[#dc2626] hover:bg-[#fee2e2]',
  amber: 'bg-[#fffbeb] text-[#d97706] hover:bg-[#fef3c7]',
  neutral: 'bg-[#eef4ff] text-[#4973dd] hover:bg-[#dce8ff]',
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Pacific/Noumea',
  }).format(new Date(iso))
}

function siteStatusInfo(status: 'critical' | 'warning' | 'normal') {
  if (status === 'critical') return { label: 'Sous tension', badge: 'bg-[#fef2f2] text-[#dc2626]', dot: 'bg-[#dc2626]' }
  if (status === 'warning') return { label: 'À surveiller', badge: 'bg-[#fffbeb] text-[#d97706]', dot: 'bg-[#f59e0b]' }
  return { label: 'Stable', badge: 'bg-[#f0fdf4] text-[#16a34a]', dot: 'bg-[#22c55e]' }
}

export function DashboardPremium({ firstName, attentionCards, visit, upcoming, sites }: Props) {
  const sorted = sortAttentionCards(attentionCards)
  const nextItems = upcoming.filter((i) => !i.isToday)
  const urgentCount = attentionCards.filter((c) => c.tone === 'red').length

  // Chantier du jour : site ayant accumulé le score de priorité le plus élevé
  // dans les attentionCards. Réutilise le moteur existant, sans nouveau calcul.
  const siteScores = new Map<string, number>()
  for (const card of attentionCards) {
    if (card.siteLabel) siteScores.set(card.siteLabel, (siteScores.get(card.siteLabel) ?? 0) + card.priority)
  }
  let topSiteLabel: string | null = null
  let topScore = 0
  for (const [label, score] of siteScores) {
    if (score > topScore) { topScore = score; topSiteLabel = label }
  }
  const primarySiteId = visit.sites[0]?.siteId ?? null
  const primarySite = primarySiteId ? (sites.find((s) => s.id === primarySiteId) ?? null) : null
  const focusSite = (topSiteLabel ? (sites.find((s) => s.name === topSiteLabel) ?? null) : null)
    ?? primarySite
    ?? (sites[0] ?? null)
  const focusSitePromiseCount = focusSite
    ? attentionCards.filter((c) => c.subject !== null && c.siteLabel === focusSite.name).length
    : 0

  return (
    <div className="min-h-screen bg-[#f4f6fb]">
      <div className="mx-auto max-w-lg pt-3">

        {/* ── Accueil vivant ───────────────────────────────── */}
        <div className="mb-4 px-1">
          <p className="text-lg font-bold text-[#101a35]">Bonjour {firstName} 👋</p>
          <p className="mt-0.5 text-sm text-[#65718b]">{livingPhrase(attentionCards.length)}</p>
        </div>

        {/* ── Bannière attention ────────────────────────────── */}
        {attentionCards.length > 0 && (
          <div className="mb-4 rounded-2xl bg-gradient-to-br from-[#dc2626] to-[#b91c1c] px-4 py-3.5 text-white shadow-md">
            <p className="text-sm font-bold">
              {attentionCards.length} sujet{attentionCards.length > 1 ? 's' : ''} demandent votre attention
            </p>
            <p className="mt-1 text-xs text-white/75">
              <span className="font-semibold text-white">{urgentCount} urgent{urgentCount !== 1 ? 's' : ''}</span>
              {' '}· {attentionCards.length - urgentCount} à surveiller
            </p>
          </div>
        )}

        {/* ── Chantier du jour ─────────────────────────────── */}
        {focusSite && (() => {
          const { label: statusLabel, badge: statusBadge, dot: statusDot } = siteStatusInfo(focusSite.status)
          return (
            <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-[#e5eaf3]">
              <div className="flex items-center justify-between bg-[#f8faff] px-4 py-2.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#65718b]">
                  Chantier du jour
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusBadge}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                  {statusLabel}
                </span>
              </div>
              <div className="px-4 py-4">
                <h2 className="truncate text-[15px] font-bold leading-tight text-[#101a35]">{focusSite.name}</h2>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {focusSite.overdueActionCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-[#fef2f2] px-2 py-1 text-xs font-semibold text-[#dc2626]">
                      {focusSite.overdueActionCount} en retard
                    </span>
                  )}
                  {focusSite.openReserveCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-[#fffbeb] px-2 py-1 text-xs font-semibold text-[#d97706]">
                      {focusSite.openReserveCount} réserve{focusSite.openReserveCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {focusSitePromiseCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-[#eef4ff] px-2 py-1 text-xs font-semibold text-[#4973dd]">
                      {focusSitePromiseCount} promesse{focusSitePromiseCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {focusSite.activeActionCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-[#f5f7fb] px-2 py-1 text-xs font-semibold text-[#33415c]">
                      {focusSite.activeActionCount} action{focusSite.activeActionCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <Link
                  href={focusSite.href}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#101a35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a2a50]"
                >
                  Ouvrir le chantier <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          )
        })()}

        {/* ── À traiter en priorité ─────────────────────────── */}
        {sorted.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-[#e5eaf3]">
            <div className="flex items-center justify-between bg-[#f8faff] px-4 py-2.5">
              <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-[#65718b]">À traiter</h2>
              <Link href="/actions" className="text-xs font-semibold text-[#4973dd]">
                Tout voir ({sorted.length}) ›
              </Link>
            </div>
            <ul className="divide-y divide-[#f5f7fb]">
              {sorted.slice(0, 5).map((card) => (
                <li key={card.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <span
                      className={`inline-block rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-[0.1em] ${FAMILY_COLORS[card.tone]}`}
                    >
                      {familyLabel(card)}
                    </span>
                    <p className="mt-1 text-[13px] font-semibold leading-snug text-[#17213a]">{card.title}</p>
                    <p className="mt-0.5 text-[11px] text-[#65718b]">
                      {card.siteLabel}{card.timingLabel ? ` · ${card.timingLabel}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {card.subject !== null ? (
                      <QuickConfirmButton subject={card.subject} />
                    ) : card.primaryAction ? (
                      <Link
                        href={card.primaryAction.href}
                        className={`inline-flex items-center rounded-xl px-3 py-1.5 text-xs font-semibold ${CTA_COLORS[card.tone]}`}
                      >
                        {ctaLabel(card)}
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Prochaines échéances ─────────────────────────── */}
        {nextItems.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-[#e5eaf3]">
            <div className="flex items-center justify-between bg-[#f8faff] px-4 py-2.5">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#65718b]">Prochaines échéances</h3>
              <Link href="/planning" className="text-[10px] font-semibold text-[#4973dd]">Voir tout ›</Link>
            </div>
            <ul className="grid grid-cols-2 divide-x divide-y divide-[#f5f7fb]">
              {nextItems.slice(0, 4).map((item) => (
                <li key={`${item.sourceType}:${item.id}`}>
                  <Link href={item.href} className="block px-4 py-3 hover:bg-[#f8faff]">
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
