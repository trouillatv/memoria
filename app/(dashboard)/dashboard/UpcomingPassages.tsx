import Link from 'next/link'
import { Calendar, ClipboardCheck, Truck, MapPin, ChevronRight } from 'lucide-react'
import type { UpcomingDashboardItem, UpcomingItemKind } from '@/lib/db/upcoming-items'

const KIND_ICON: Record<UpcomingItemKind, React.ComponentType<{ className?: string }>> = {
  inspection: ClipboardCheck,
  meeting: Calendar,
  delivery: Truck,
  visit: MapPin,
  other: Calendar,
}

const KIND_LABEL: Record<UpcomingItemKind, string> = {
  inspection: 'Inspection',
  meeting: 'Réunion',
  delivery: 'Livraison',
  visit: 'Visite',
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
    <section className="h-full rounded-3xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between px-5 pb-4 pt-5">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Prochains passages
        </h2>
        {items.length === 0 && null}
      </div>

      {items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground italic">
          Aucun passage planifié dans les 30 prochains jours. Ajoutez des événements
          depuis la fiche d&apos;un site pour les voir apparaître ici.
        </p>
      ) : (
        <ul className="space-y-2 px-4 pb-4">
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind]
            return (
              <li key={`${item.sourceType}:${item.id}`}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-3 py-3 transition-all hover:border-slate-200 hover:bg-white hover:shadow-sm"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600"><Icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold leading-snug text-slate-900">
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
