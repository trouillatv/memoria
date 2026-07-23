import Link from 'next/link'
import { Calendar, ClipboardCheck, Truck, ChevronRight } from 'lucide-react'
import type { UpcomingDashboardItem, UpcomingItemKind } from '@/lib/db/upcoming-items'

const KIND_ICON: Record<UpcomingItemKind, React.ComponentType<{ className?: string }>> = {
  inspection: ClipboardCheck,
  meeting: Calendar,
  delivery: Truck,
  other: Calendar,
}

const KIND_LABEL: Record<UpcomingItemKind, string> = {
  inspection: 'Inspection',
  meeting: 'Réunion',
  delivery: 'Livraison',
  other: 'Évènement',
}

function formatPassageDate(iso: string, isToday: boolean): string {
  if (isToday) return "Aujourd'hui"
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

interface UpcomingPassagesProps {
  items: UpcomingDashboardItem[]
}

export function UpcomingPassages({ items }: UpcomingPassagesProps) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Prochains passages
        </h2>
        {items.length === 0 && null}
      </div>

      {items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground italic">
          Aucun passage planifié dans les 30 prochains jours.
        </p>
      ) : (
        <ul className="divide-y divide-border/40">
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind]
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug truncate">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {item.siteName}
                      {item.clientName ? ` · ${item.clientName}` : ''}
                      {' · '}
                      <span className={item.isToday ? 'text-amber-600 font-medium' : ''}>
                        {formatPassageDate(item.startsAt, item.isToday)}
                      </span>
                      {' · '}
                      {KIND_LABEL[item.kind]}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
