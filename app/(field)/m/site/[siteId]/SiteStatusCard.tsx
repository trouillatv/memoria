import Link from 'next/link'
import { ListChecks, AlertTriangle, Footprints, Users, ChevronRight } from 'lucide-react'
import type { SiteStatusCell, SiteStatusMetric, SiteStatusTone } from '@/lib/db/visits'

/**
 * « État du chantier » — le HÉROS de la fiche : quatre grandes cartes tactiles
 * (icône colorée + gros chiffre + libellé + « Voir »). Fond légèrement teinté,
 * bordure douce, légère ombre → on comprend au premier regard qu'on peut les
 * ouvrir. Déterministe.
 */
const ICON: Record<SiteStatusMetric, typeof ListChecks> = {
  actions: ListChecks,
  reserves: AlertTriangle,
  lastVisit: Footprints,
  nextMeeting: Users,
}
// La couleur est portée par l'icône + un fond très pâle ; le texte reste sombre.
const METRIC_TINT: Record<SiteStatusMetric, string> = {
  actions: 'bg-slate-50/70 dark:bg-slate-900/30',
  reserves: 'bg-amber-50/60 dark:bg-amber-950/25',
  lastVisit: 'bg-emerald-50/60 dark:bg-emerald-950/25',
  nextMeeting: 'bg-sky-50/60 dark:bg-sky-950/25',
}
const TONE_ICON: Record<SiteStatusTone, string> = {
  alert: 'text-red-600 dark:text-red-400',
  warn: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground',
}
const TONE_VOIR: Record<SiteStatusTone, string> = {
  alert: 'text-red-600 dark:text-red-400',
  warn: 'text-amber-600 dark:text-amber-400',
  info: 'text-emerald-600 dark:text-emerald-400',
}

export function SiteStatusCard({ cells }: { cells: SiteStatusCell[] }) {
  if (cells.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">État du chantier</h2>
      <div className="grid grid-cols-2 gap-2">
        {cells.map((c) => {
          const Icon = ICON[c.key]
          const tint = c.key === 'actions' && c.tone !== 'info'
            ? (c.tone === 'alert' ? 'bg-red-50/60 dark:bg-red-950/25' : 'bg-amber-50/60 dark:bg-amber-950/25')
            : METRIC_TINT[c.key]
          const inner = (
            <>
              <Icon className={`h-5 w-5 ${TONE_ICON[c.tone]}`} />
              <span className="mt-2 text-2xl font-semibold leading-none tabular-nums">{c.value}</span>
              <span className="mt-1.5 text-xs text-muted-foreground">{c.label}</span>
              {c.href && (
                <span className={`mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium ${TONE_VOIR[c.tone]}`}>
                  Voir <ChevronRight className="h-3 w-3" />
                </span>
              )}
            </>
          )
          const cls = `flex flex-col items-start rounded-2xl border shadow-sm p-4 ${tint}`
          return c.href ? (
            <Link key={c.key} href={c.href} className={`${cls} active:brightness-95`}>{inner}</Link>
          ) : (
            <div key={c.key} className={cls}>{inner}</div>
          )
        })}
      </div>
    </section>
  )
}
