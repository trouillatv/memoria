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
import { ActionCheckbox } from './ActionCheckbox'

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

// ── Briefing conditionnel ────────────────────────────────────────────────────

type DailyBriefing = {
  headline: string
  supportingText?: string
  tone: 'critical' | 'warning' | 'neutral'
  /** Vrai quand le site est nommé dans headline ou supportingText — évite la répétition dans la carte blanche. */
  siteNamedAbove: boolean
}

function computeDailyBriefing(
  attentionCards: AttentionCard[],
  focusSite: SiteDashboardItem | null,
  urgentCount: number,
): DailyBriefing {
  if (urgentCount > 0) {
    const urgentSiteNames = new Set(
      attentionCards.filter((c) => c.tone === 'red' && c.siteLabel).map((c) => c.siteLabel!),
    )
    const siteUrgentCount = focusSite
      ? attentionCards.filter((c) => c.tone === 'red' && c.siteLabel === focusSite.name).length
      : 0

    if (focusSite && urgentSiteNames.size === 1) {
      return {
        headline: `Tu peux remettre ${focusSite.name} sous contrôle aujourd'hui.`,
        supportingText: siteUrgentCount === 1
          ? 'Commence par son urgence.'
          : `Commence par ses ${siteUrgentCount} urgences.`,
        tone: 'critical',
        siteNamedAbove: true,
      }
    }
    return {
      headline: `${urgentSiteNames.size} chantiers ont besoin de toi aujourd'hui.`,
      supportingText: focusSite ? `${focusSite.name} est ta priorité aujourd'hui.` : undefined,
      tone: 'critical',
      siteNamedAbove: true,
    }
  }

  if (attentionCards.length > 0 && focusSite) {
    return {
      headline: 'La journée est maîtrisable.',
      supportingText: `${attentionCards.length} point${attentionCards.length > 1 ? 's' : ''} reste${attentionCards.length > 1 ? 'nt' : ''} à surveiller.`,
      tone: 'warning',
      siteNamedAbove: false,
    }
  }

  return {
    headline: 'Tes chantiers sont sous contrôle.',
    supportingText: undefined,
    tone: 'neutral',
    siteNamedAbove: false,
  }
}

// Fonds sombres et calmes — le rouge reste un accent, pas le fond du hero.
const HERO_BG: Record<DailyBriefing['tone'], string> = {
  critical: 'bg-gradient-to-br from-[#2c1830] to-[#1a0f22]',   // prune désaturé, tension portée par l'accent
  warning: 'bg-gradient-to-br from-[#282008] to-[#161202]',    // olive nuit
  neutral: 'bg-gradient-to-br from-[#0e2240] to-[#091828]',    // navy profond
}

// Bande d'accent colorée en haut du hero (fine, non agressive)
const HERO_ACCENT: Record<DailyBriefing['tone'], string> = {
  critical: 'bg-[#dc2626]',
  warning: 'bg-[#d97706]',
  neutral: 'bg-[#22c55e]',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  if (card.icon === 'calendar') return card.tone === 'red' ? "Voir l'action" : 'Planifier'
  if (card.icon === 'document') return 'Compléter'
  if (card.icon === 'warning') return 'Voir la réserve'
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

function todayLongDate(): string {
  const s = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Pacific/Noumea',
  }).format(new Date())
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function siteStatusInfo(status: 'critical' | 'warning' | 'normal') {
  if (status === 'critical') return { label: 'Sous tension', badge: 'bg-[#fef2f2] text-[#dc2626]', dot: 'bg-[#dc2626]' }
  if (status === 'warning') return { label: 'À surveiller', badge: 'bg-[#fffbeb] text-[#d97706]', dot: 'bg-[#f59e0b]' }
  return { label: 'Stable', badge: 'bg-[#f0fdf4] text-[#16a34a]', dot: 'bg-[#22c55e]' }
}

// ── Composant ────────────────────────────────────────────────────────────────

export function DashboardPremium({ firstName, attentionCards, visit, upcoming, sites, now }: Props) {
  const sorted = sortAttentionCards(attentionCards)
  const nextItems = upcoming.filter((i) => !i.isToday)
  const urgentCount = attentionCards.filter((c) => c.tone === 'red').length

  const overdueActionsCount = attentionCards.filter((c) => c.subject === null && c.icon === 'calendar' && c.tone === 'red').length
  const overduePromisesCount = attentionCards.filter((c) => c.subject !== null && c.tone === 'red').length
  const criticalReservesCount = attentionCards.filter((c) => c.icon === 'warning' && c.tone === 'red').length
  const urgentSiteCount = new Set(attentionCards.filter((c) => c.tone === 'red' && c.siteLabel).map((c) => c.siteLabel)).size

  // Chantier du jour : somme des priorités par siteLabel
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

  const briefing = computeDailyBriefing(attentionCards, focusSite, urgentCount)

  // La carte blanche du bas n'a de sens que si le chantier a vraiment des éléments à traiter.
  const showFocusCard = focusSite && (
    briefing.tone !== 'neutral' ||
    focusSite.overdueActionCount > 0 ||
    focusSite.openReserveCount > 0 ||
    focusSitePromiseCount > 0
  )

  return (
    <div className="min-h-screen bg-[#f4f6fb]">
      <div className="mx-auto max-w-lg pt-3">

        {/* ── Hero : briefing + chantier du jour ───────────────── */}
        <div className="mb-4 overflow-hidden rounded-3xl shadow-lg">

          {/* Bande d'accent — couleur sémantique discrète */}
          <div className={`h-[3px] ${HERO_ACCENT[briefing.tone]}`} />

          {/* Top coloré — mission du jour */}
          <div className={`px-5 pt-4 pb-6 ${HERO_BG[briefing.tone]}`}>
            <p className="text-[11px] font-semibold text-white/50">Bonjour {firstName} 👋</p>
            <p className="mt-0.5 text-[11px] text-white/40">{todayLongDate()}</p>
            <h1 className="mt-2 text-[19px] font-bold leading-snug text-white">
              {briefing.headline}
            </h1>
            {briefing.supportingText && (
              <p className="mt-1.5 text-sm text-white/75">{briefing.supportingText}</p>
            )}
            {urgentCount > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/55">
                {/* Métriques GLOBALES (tous chantiers) — les causes propres au
                    chantier sélectionné sont dans la carte blanche dessous. */}
                {urgentSiteCount > 1 && <span className="text-white/35">Sur l&apos;ensemble :</span>}
                {overdueActionsCount > 0 && (
                  <span>{overdueActionsCount} action{overdueActionsCount > 1 ? 's' : ''} en retard</span>
                )}
                {overduePromisesCount > 0 && (
                  <span>{overduePromisesCount} promesse{overduePromisesCount > 1 ? 's' : ''} dépassée{overduePromisesCount > 1 ? 's' : ''}</span>
                )}
                {criticalReservesCount > 0 && (
                  <span>{criticalReservesCount} réserve{criticalReservesCount > 1 ? 's' : ''} critique{criticalReservesCount > 1 ? 's' : ''}</span>
                )}
                {(attentionCards.length - urgentCount) > 0 && (
                  <span className="text-white/40">{attentionCards.length - urgentCount} point{attentionCards.length - urgentCount > 1 ? 's' : ''} à surveiller</span>
                )}
              </div>
            )}
            {briefing.tone === 'neutral' && (
              <p className="mt-3 text-xs text-[#4ade80]/80">Aucun blocage critique — tes chantiers restent sous contrôle.</p>
            )}
          </div>

          {/* Bas blanc — chantier du jour (seulement si pertinent) */}
          {showFocusCard && (() => {
            const { label: statusLabel, badge: statusBadge, dot: statusDot } = siteStatusInfo(focusSite.status)
            // Le hero a déjà nommé le chantier → la zone blanche explique le choix.
            const cardLabel = briefing.siteNamedAbove
              ? 'Pourquoi ce chantier'
              : briefing.tone === 'warning' ? 'À garder à l\'œil' : 'Chantier prioritaire'
            return (
              <div className="bg-white px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#65718b]">
                    {cardLabel}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusBadge}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                    {statusLabel}
                  </span>
                </div>
                {/* Nom du chantier uniquement si pas déjà nommé dans le hero */}
                {!briefing.siteNamedAbove && (
                  <>
                    <p className="mt-1.5 text-[15px] font-bold text-[#101a35]">{focusSite.name}</p>
                    <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9aa7be]">Sélectionné car</p>
                  </>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  {focusSite.overdueActionCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-[#fef2f2] px-2 py-1 text-xs font-semibold text-[#dc2626]">
                      {focusSite.overdueActionCount} action{focusSite.overdueActionCount > 1 ? 's' : ''} en retard
                    </span>
                  )}
                  {focusSite.openReserveCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-[#fffbeb] px-2 py-1 text-xs font-semibold text-[#d97706]">
                      {focusSite.openReserveCount} réserve{focusSite.openReserveCount > 1 ? 's' : ''} ouverte{focusSite.openReserveCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {focusSitePromiseCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-[#eef4ff] px-2 py-1 text-xs font-semibold text-[#4973dd]">
                      {focusSitePromiseCount} promesse{focusSitePromiseCount > 1 ? 's' : ''} à confirmer
                    </span>
                  )}
                  {/* Volume générique en fallback seulement — les pills doivent être causales */}
                  {focusSite.overdueActionCount === 0 && focusSite.openReserveCount === 0 && focusSitePromiseCount === 0 && focusSite.activeActionCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-[#f5f7fb] px-2 py-1 text-xs font-semibold text-[#33415c]">
                      {focusSite.activeActionCount} action{focusSite.activeActionCount > 1 ? 's' : ''} ouverte{focusSite.activeActionCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {/* Réassurance factuelle : aucune carte rouge sur ce chantier */}
                {briefing.tone === 'warning' && focusSite.overdueActionCount === 0 && (
                  <p className="mt-2.5 text-xs font-medium text-[#16a34a]">
                    Aucun blocage critique sur ce chantier.
                  </p>
                )}
                <Link
                  href={focusSite.href}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#101a35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a2a50]"
                >
                  Ouvrir le chantier <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            )
          })()}

          {/* Bas neutre — état stable, aucun chantier urgent à mettre en avant */}
          {!showFocusCard && briefing.tone === 'neutral' && nextItems.length > 0 && (
            <div className="bg-white px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#65718b]">Prochaine échéance</p>
              {(() => {
                const next = nextItems[0]
                return (
                  <Link href={next.href} className="mt-1.5 flex items-center justify-between hover:opacity-75">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[#4973dd]">
                        {shortDate(next.startsAt)}
                      </p>
                      <p className="mt-0.5 text-[13px] font-semibold text-[#17213a]">{next.title}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#9aa7be]" />
                  </Link>
                )
              })()}
            </div>
          )}
        </div>

        {/* ── À traiter en priorité ─────────────────────────── */}
        {sorted.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-[#e5eaf3]">
            <div className="flex items-center justify-between bg-[#f8faff] px-4 py-2.5">
              <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-[#65718b]">À traiter</h2>
              <Link
                href="/actions"
                className="inline-flex items-center gap-1 rounded-lg bg-[#eef4ff] px-2.5 py-1 text-[11px] font-semibold text-[#4973dd] hover:bg-[#dce8ff]"
              >
                Voir les {sorted.length}
              </Link>
            </div>
            <ul className="divide-y divide-[#f5f7fb]">
              {sorted.slice(0, 3).map((card) => (
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

        {/* ── À faire maintenant ────────────────────────────── */}
        {now.items.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-[#e5eaf3]">
            <div className="flex items-center justify-between bg-[#f8faff] px-4 py-2.5">
              <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-[#65718b]">À faire maintenant</h2>
            </div>
            <ul className="divide-y divide-[#f5f7fb]">
              {now.items.slice(0, 3).map((item) => (
                <li key={`${item.sourceType}:${item.id}`} className="flex items-center gap-3 px-4 py-3">
                  {item.canComplete && item.actionId ? (
                    <ActionCheckbox actionId={item.actionId} siteId={item.siteId} label={item.title} />
                  ) : null}
                  <Link href={item.href} className="min-w-0 flex-1 hover:opacity-75">
                    <p className="text-[13px] font-semibold leading-snug text-[#17213a]">{item.title}</p>
                    <p className="mt-0.5 text-[11px] text-[#65718b]">
                      {item.siteName}
                      {item.priority === 'urgent' ? ' · en retard' : item.priority === 'today' ? " · aujourd'hui" : ''}
                    </p>
                  </Link>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#c3cddd]" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Depuis ta dernière visite / Activité récente ─── */}
        {(() => {
          const focusImpact = focusSite ? (visit.sites.find((s) => s.siteId === focusSite.id) ?? null) : null
          const useFocus = focusImpact !== null && focusImpact.events.length > 0
          const events = useFocus
            ? focusImpact.events.slice(0, 3).map((e) => ({ id: e.id, at: e.at, label: e.label, siteName: null as string | null }))
            : visit.events.slice(0, 3).map((e) => ({ id: e.id, at: e.at, label: e.label, siteName: e.siteName as string | null }))
          if (events.length === 0) return null
          const title = useFocus ? focusImpact.sinceLabel : 'Activité récente'
          return (
            <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-[#e5eaf3]">
              <div className="flex items-center justify-between bg-[#f8faff] px-4 py-2.5">
                <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-[#65718b]">{title}</h2>
                <Link href="/journal" className="text-[10px] font-semibold text-[#4973dd]">Journal ›</Link>
              </div>
              <ul className="divide-y divide-[#f5f7fb]">
                {events.map((e) => (
                  <li key={e.id} className="px-4 py-2.5">
                    <p className="text-[12px] font-medium leading-snug text-[#17213a]">{e.label}</p>
                    <p className="mt-0.5 text-[10px] text-[#9aa7be]">
                      {e.siteName ? `${e.siteName} · ` : ''}{shortDate(e.at)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )
        })()}

        {/* ── Prochaines échéances ─────────────────────────── */}
        {nextItems.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-[#e5eaf3]">
            <div className="flex items-center justify-between bg-[#f8faff] px-4 py-2.5">
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-[#65718b]">Prochaines échéances</h3>
              <Link href="/planning" className="text-[10px] font-semibold text-[#4973dd]">Voir tout ›</Link>
            </div>
            <ul className="divide-y divide-[#f5f7fb]">
              {nextItems.slice(0, 3).map((item) => (
                <li key={`${item.sourceType}:${item.id}`}>
                  <Link href={item.href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#f8faff]">
                    <p className="min-w-0 truncate text-[12px] font-medium text-[#17213a]">{item.title}</p>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[#4973dd]">
                      {shortDate(item.startsAt)}
                    </span>
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
