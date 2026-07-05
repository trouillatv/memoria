import Link from 'next/link'
import { Clock, ChevronRight } from 'lucide-react'
import type { RecentActivityItem } from '@/lib/db/visits'

/**
 * « Récent » — la fin de la feuille de journée : ma dernière visite, mon dernier
 * compte-rendu, pour y revenir vite. Narratif, sobre, sans chiffres. On ne montre
 * que ce qui existe (les deux ouvrent le récap, qui accepte tout site_report).
 */
export function RecentActivityCard({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="inline-flex items-center gap-1.5 text-base font-semibold tracking-tight">
        <Clock className="h-4 w-4 text-muted-foreground" /> Récent
      </h2>
      <ul className="overflow-hidden rounded-xl border bg-card divide-y">
        {items.map((i) => (
          <li key={i.reportId}>
            <Link href={`/m/visite/${i.reportId}/recap`} className="flex items-center gap-3 px-3.5 py-3 active:bg-accent">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{i.label}</span>
                <span className="block text-[12px] text-muted-foreground">{i.sub}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
