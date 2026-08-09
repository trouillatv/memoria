import Link from 'next/link'
import { AlertTriangle, ArrowRight, Clock, RefreshCw, ShieldAlert, TrendingDown, Zap } from 'lucide-react'
import { deriveSiteAttentionItems, type AttentionSignal, type AttentionUrgency, type SiteAttentionItem } from '@/lib/knowledge/site-attention-items'
import { cn } from '@/lib/utils'

// ── BLOC "À RETENIR MAINTENANT" ───────────────────────────────────────────────
// Doctrine : ce composant ne lit que deriveSiteAttentionItems() — pas de
// lib/db/* direct. Il suit la même règle que SiteOverviewTab avec getSiteOverview.

const URGENCY_BADGE: Record<AttentionUrgency, { label: string; className: string }> = {
  critical: { label: 'Critique', className: 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900' },
  high:     { label: 'Important', className: 'bg-orange-50 text-orange-700 ring-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900' },
  medium:   { label: 'À surveiller', className: 'bg-yellow-50 text-yellow-700 ring-yellow-100 dark:bg-yellow-950/30 dark:text-yellow-300 dark:ring-yellow-900' },
  low:      { label: 'Information', className: 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900' },
}

const SIGNAL_ICON: Record<AttentionSignal, typeof AlertTriangle> = {
  subject_stagnant:  RefreshCw,
  action_overdue:    Clock,
  deadline_near:     Clock,
  deadline_overdue:  Clock,
  reserve_open:      AlertTriangle,
  relation_blocking: Zap,
  blocage_active:    ShieldAlert,
  actor_congestion:  AlertTriangle,
  subject_changed:   RefreshCw,
  proposal_pending:  ArrowRight,
  link_suggested:    ArrowRight,
  pv_status:         TrendingDown,
  pv_stagnant:       RefreshCw,
}

function AttentionItemRow({ item }: { item: SiteAttentionItem }) {
  const badge = URGENCY_BADGE[item.urgency]
  const Icon = SIGNAL_ICON[item.signal]

  return (
    <Link
      href={item.href}
      className="group flex items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-muted/50"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium leading-snug text-foreground">
            {item.title}
          </span>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
            badge.className,
          )}>
            {badge.label}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {item.reason}
        </p>
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </Link>
  )
}

export async function SiteAttentionSection({ siteId }: { siteId: string }) {
  const items = await deriveSiteAttentionItems(siteId).catch(() => [])
  if (items.length === 0) return null

  const top = items.slice(0, 3)
  const rest = items.length - 3

  return (
    <section aria-labelledby="attention-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="attention-heading"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Ce qui demande votre attention
        </h2>
        {rest > 0 && (
          <span className="text-xs text-muted-foreground">
            {rest} autre{rest > 1 ? 's' : ''} point{rest > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {top.map((item, i) => (
          <AttentionItemRow key={i} item={item} />
        ))}
      </div>
    </section>
  )
}

export function SiteAttentionSkeleton() {
  return (
    <section>
      <div className="mb-3 h-4 w-40 rounded bg-muted animate-pulse" />
      <div className="space-y-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-14 rounded-lg border bg-card animate-pulse" />
        ))}
      </div>
    </section>
  )
}
