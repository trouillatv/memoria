import Link from 'next/link'
import { ListChecks, AlertTriangle, Footprints, Users } from 'lucide-react'
import type { SiteStatusCell, SiteStatusMetric, SiteStatusTone } from '@/lib/db/visits'

/**
 * « État du chantier » — le HÉROS de la fiche : quatre grandes cartes (icône +
 * chiffre + libellé). Le cerveau lit la situation en une seconde. Chaque carte
 * ouvre son détail. Déterministe.
 */
const ICON: Record<SiteStatusMetric, typeof ListChecks> = {
  actions: ListChecks,
  reserves: AlertTriangle,
  lastVisit: Footprints,
  nextMeeting: Users,
}
const TONE: Record<SiteStatusTone, string> = {
  alert: 'text-red-600 dark:text-red-400',
  warn: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground',
}

export function SiteStatusCard({ cells }: { cells: SiteStatusCell[] }) {
  if (cells.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">État du chantier</h2>
      <div className="grid grid-cols-2 gap-2">
        {cells.map((c) => {
          const Icon = ICON[c.key]
          const inner = (
            <>
              <Icon className={`h-5 w-5 ${TONE[c.tone]}`} />
              <span className="mt-2 text-2xl font-semibold leading-none tabular-nums">{c.value}</span>
              <span className="mt-1.5 text-xs text-muted-foreground">{c.label}</span>
            </>
          )
          const cls = 'flex flex-col items-start rounded-2xl border bg-card p-4'
          return c.href ? (
            <Link key={c.key} href={c.href} className={`${cls} active:bg-accent`}>{inner}</Link>
          ) : (
            <div key={c.key} className={cls}>{inner}</div>
          )
        })}
      </div>
    </section>
  )
}
