import Link from 'next/link'
import { Calendar, ClipboardCheck, Truck, MapPin, ChevronRight } from 'lucide-react'
import type { UpcomingDashboardItem, UpcomingItemKind } from '@/lib/db/upcoming-items'
import type { DashboardDeadlineToPlan } from '@/lib/db/dashboard-deadlines'
import { OrganizationBadge } from '@/components/dashboard/OrgBadge'

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
  deadlinesToPlan: DashboardDeadlineToPlan[]
}

export function UpcomingPassages({ items, deadlinesToPlan }: UpcomingPassagesProps) {
  return (
    <section className="h-full rounded-3xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between px-5 pb-4 pt-5">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Passages et échéances à organiser
        </h2>
        {items.length === 0 && null}
      </div>

      <div className="space-y-4 px-4 pb-4">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Planifiés</p>
          {items.length === 0 ? <p className="rounded-2xl bg-slate-50 px-3 py-3 text-xs italic text-muted-foreground">Aucun passage planifié dans les 30 prochains jours.</p> : <ul className="space-y-2">
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
          </ul>}
        </div>
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">À planifier</p>
          {deadlinesToPlan.length === 0 ? <p className="rounded-2xl bg-emerald-50 px-3 py-3 text-xs text-emerald-700">Aucune échéance à organiser.</p> : <ul className="space-y-2">{deadlinesToPlan.map((deadline) => <li key={deadline.id} className="rounded-2xl border border-amber-100 bg-amber-50/50 px-3 py-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">{deadline.title}</p><p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><OrganizationBadge organization={deadline.organization} size="xs" /> {deadline.siteName}{deadline.clientName ? ` · ${deadline.clientName}` : ''}</p><p className="mt-1 text-xs text-amber-700">{deadline.constraintText || 'Date à choisir'}</p></div><Link href={deadline.href} className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-semibold text-amber-700 shadow-sm ring-1 ring-amber-200 hover:bg-amber-50">Planifier</Link></div></li>)}</ul>}
        </div>
      </div>
    </section>
  )
}
