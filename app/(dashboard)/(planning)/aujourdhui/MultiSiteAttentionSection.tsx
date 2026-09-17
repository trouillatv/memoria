import Link from 'next/link'
import { ArrowRight, RefreshCw, ShieldAlert, TrendingDown } from 'lucide-react'
import { deriveMultiSiteAttention, type SiteAttentionScore } from '@/lib/knowledge/multi-site-attention'
import type { CanonicalAttentionItem } from '@/lib/knowledge/canonical-attention'
import { cn } from '@/lib/utils'

// ── BLOC "CHANTIERS À SURVEILLER" ─────────────────────────────────────────────
// Doctrine P0-D : Aujourd'hui classe les CHANTIERS, pas les sujets.
// Les sujets servent à expliquer pourquoi un chantier est remonté.
// 1-2 sujets représentatifs par chantier. Aucun score affiché.

type SiteUrgency = Exclude<SiteAttentionScore['urgency'], 'none'>

const URGENCY_BADGE: Record<SiteUrgency, { label: string; className: string }> = {
  critical: { label: 'Critique',     className: 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900' },
  high:     { label: 'Important',    className: 'bg-orange-50 text-orange-700 ring-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900' },
  medium:   { label: 'À surveiller', className: 'bg-yellow-50 text-yellow-700 ring-yellow-100 dark:bg-yellow-950/30 dark:text-yellow-300 dark:ring-yellow-900' },
  low:      { label: 'Information',  className: 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900' },
}

function urgencyIcon(urgency: SiteUrgency) {
  if (urgency === 'critical') return ShieldAlert
  if (urgency === 'high')     return TrendingDown
  return RefreshCw
}

function SubjectLine({ item }: { item: CanonicalAttentionItem }) {
  return (
    <Link
      href={item.href}
      className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors -mx-2"
    >
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-foreground group-hover:underline underline-offset-2">
          {item.title}
        </span>
        {item.reasons[0] && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground line-clamp-1">
            {item.reasons[0]}
          </p>
        )}
      </div>
      <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </Link>
  )
}

function SiteCard({ entry }: { entry: SiteAttentionScore }) {
  if (entry.urgency === 'none') return null
  const badge = URGENCY_BADGE[entry.urgency]
  const Icon = urgencyIcon(entry.urgency)
  const subjectCount = entry.topSubjects.length
  const label = subjectCount > 1 ? `${subjectCount} sujets à voir` : '1 sujet à voir'

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      {/* En-tête du chantier */}
      <Link
        href={`/sites/${entry.siteId}`}
        className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        <div className="min-w-0 flex-1 flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold leading-snug text-foreground">
            {entry.siteName}
          </span>
          <span className="text-xs text-muted-foreground">
            — {label}
          </span>
        </div>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
          badge.className,
        )}>
          {badge.label}
        </span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      </Link>

      {/* Sujets représentatifs */}
      {entry.topSubjects.length > 0 && (
        <div className="px-4 pb-3 border-t bg-muted/20 space-y-0.5 pt-2">
          {entry.topSubjects.map((sub, i) => (
            <SubjectLine key={i} item={sub} />
          ))}
        </div>
      )}
    </div>
  )
}

export async function MultiSiteAttentionSection() {
  const sites = await deriveMultiSiteAttention({ limit: 5 }).catch(() => [])
  if (sites.length === 0) return null

  return (
    <section aria-labelledby="multisite-attention-heading">
      <div className="mb-3">
        <h2
          id="multisite-attention-heading"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Chantiers à surveiller
        </h2>
      </div>
      <div className="space-y-2">
        {sites.map((entry) => (
          <SiteCard key={entry.siteId} entry={entry} />
        ))}
      </div>
    </section>
  )
}

export function MultiSiteAttentionSkeleton() {
  return (
    <section>
      <div className="mb-3 h-4 w-44 rounded bg-muted animate-pulse" />
      <div className="space-y-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-20 rounded-lg border bg-card animate-pulse" />
        ))}
      </div>
    </section>
  )
}
