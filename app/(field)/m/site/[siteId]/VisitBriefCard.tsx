import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { BriefItem, BriefItemKind, VisitBrief } from '@/lib/db/site-visit-brief'

/**
 * « Si vous revenez aujourd'hui » — briefing terrain déterministe.
 * Une ligne = un objet réel, avec son contexte temporel.
 * Ordre : retard le plus important → réserve la plus ancienne → échéance la plus proche.
 * 4 items max + débordement silencieux (« +N autres »).
 * Silence total si rien à signaler.
 */
const KIND_META: Record<BriefItemKind, { dot: string; badge: string }> = {
  action_overdue: {
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  },
  reserve_aging: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  },
  deadline_soon: {
    dot: 'bg-violet-400',
    badge: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  },
}

function BriefRow({ item }: { item: BriefItem }) {
  const meta = KIND_META[item.kind]
  const inner = (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[14px] leading-snug">{item.label}</span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${meta.badge}`}>
        {item.detail}
      </span>
      {item.href && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </div>
  )

  if (item.href) {
    return (
      <li>
        <Link href={item.href} className="block active:opacity-70">
          {inner}
        </Link>
      </li>
    )
  }
  return <li>{inner}</li>
}

export function VisitBriefCard({ brief, siteId }: { brief: VisitBrief; siteId: string }) {
  if (brief.items.length === 0) return null

  return (
    <section className="rounded-2xl border bg-card p-4" data-testid="visit-brief-card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Si vous revenez aujourd&apos;hui
      </h2>
      <ul className="mt-2 divide-y divide-border/50">
        {brief.items.map((item, i) => (
          <BriefRow key={i} item={item} />
        ))}
      </ul>
      {brief.overflow > 0 && (
        <Link
          href={`/m/actions?site=${siteId}`}
          className="mt-2 inline-flex items-center gap-0.5 text-[12px] text-primary active:opacity-70"
        >
          +{brief.overflow} autre{brief.overflow > 1 ? 's' : ''} à traiter
          <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </section>
  )
}
