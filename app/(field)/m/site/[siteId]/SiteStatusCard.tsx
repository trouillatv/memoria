import Link from 'next/link'
import { ListChecks, AlertTriangle, CalendarDays, Users } from 'lucide-react'
import type { SiteStatusCell, SiteStatusMetric, SiteStatusTone } from '@/lib/db/visits'

/**
 * « État du chantier » — la santé en 4 chiffres, façon tableau de bord Apple :
 * actions ouvertes · réserves · dernière visite · prochaine réunion. Chaque
 * cellule est cliquable vers son détail (« Voir »). Déterministe.
 */
const ICON: Record<SiteStatusMetric, typeof ListChecks> = {
  actions: ListChecks,
  reserves: AlertTriangle,
  lastVisit: CalendarDays,
  nextMeeting: Users,
}
const TONE: Record<SiteStatusTone, { icon: string; voir: string }> = {
  alert: { icon: 'text-red-600 dark:text-red-400', voir: 'text-red-600 dark:text-red-400' },
  warn: { icon: 'text-amber-600 dark:text-amber-400', voir: 'text-amber-600 dark:text-amber-400' },
  info: { icon: 'text-muted-foreground', voir: 'text-emerald-600 dark:text-emerald-400' },
}

export function SiteStatusCard({ cells }: { cells: SiteStatusCell[] }) {
  if (cells.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">État du chantier</h2>
      <div className="grid grid-cols-4 gap-1.5">
        {cells.map((c) => {
          const Icon = ICON[c.key]
          const tone = TONE[c.tone]
          const inner = (
            <>
              <Icon className={`h-[18px] w-[18px] ${tone.icon}`} />
              <span className="text-sm font-semibold leading-none tabular-nums">{c.value}</span>
              <span className="text-[10px] leading-tight text-center text-muted-foreground">{c.label}</span>
              {c.href && <span className={`text-[11px] font-medium ${tone.voir}`}>Voir</span>}
            </>
          )
          return c.href ? (
            <Link key={c.key} href={c.href} className="flex flex-col items-center gap-1.5 rounded-xl border bg-card px-1 py-3 active:bg-accent">
              {inner}
            </Link>
          ) : (
            <div key={c.key} className="flex flex-col items-center gap-1.5 rounded-xl border bg-card px-1 py-3">
              {inner}
            </div>
          )
        })}
      </div>
    </section>
  )
}
