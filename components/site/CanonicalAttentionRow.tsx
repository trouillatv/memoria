import Link from 'next/link'
import { ArrowRight, RefreshCw, ShieldAlert, TrendingDown } from 'lucide-react'
import type { CanonicalAttentionItem } from '@/lib/knowledge/canonical-attention'
import { cn } from '@/lib/utils'

// #231 — carte d'un sujet d'attention, PARTAGÉE entre l'Aperçu (top 3) et la vue
// « Attention » de la page Histoire (population complète). Même read-model
// (deriveCanonicalAttentionItems), même rendu : la destination montre EXACTEMENT ce
// que l'Aperçu résume, jamais une liste voisine recalculée.

type AttentionUrgency = CanonicalAttentionItem['urgency']

const URGENCY_BADGE: Record<AttentionUrgency, { label: string; className: string }> = {
  critical: { label: 'Critique',     className: 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900' },
  high:     { label: 'Important',    className: 'bg-orange-50 text-orange-700 ring-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900' },
  medium:   { label: 'À surveiller', className: 'bg-yellow-50 text-yellow-700 ring-yellow-100 dark:bg-yellow-950/30 dark:text-yellow-300 dark:ring-yellow-900' },
  low:      { label: 'Information',  className: 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900' },
}

function urgencyIcon(urgency: AttentionUrgency) {
  const className = 'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground'
  if (urgency === 'critical') return <ShieldAlert className={className} />
  if (urgency === 'high')     return <TrendingDown className={className} />
  return <RefreshCw className={className} />
}

export function CanonicalAttentionRow({ item }: { item: CanonicalAttentionItem }) {
  const badge = URGENCY_BADGE[item.urgency]

  return (
    <Link
      href={item.href}
      className="group flex items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-muted/50"
    >
      {urgencyIcon(item.urgency)}
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
        {item.reasons.map((reason, i) => (
          <p key={i} className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {reason}
          </p>
        ))}
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </Link>
  )
}
