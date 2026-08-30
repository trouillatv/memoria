'use client'

// Trois lectures distinctes du temps du chantier, jamais fusionnées :
// Travaux (site_planning_items — planification documentaire), Agenda
// (getPlanningTimeline — visites/réunions/roulements), Échéances
// (site_deadlines — ce qui est dû). Vue d'ensemble les agrège sans jamais
// en devenir la source de vérité.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

export type PlanningSubTab = 'apercu' | 'travaux' | 'agenda' | 'echeances'

export function PlanningSubTabs({ active, deadlinesCount }: { active: PlanningSubTab; deadlinesCount: number }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const href = (k: PlanningSubTab) => {
    const q = new URLSearchParams(params.toString())
    q.set('tab', 'planning'); q.set('plantab', k)
    return `${pathname}?${q.toString()}`
  }
  const item = (k: PlanningSubTab, label: string, badge?: number) => (
    <Link href={href(k)} scroll={false}
      className={cn('inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm',
        active === k ? 'bg-foreground font-semibold text-background' : 'text-muted-foreground hover:text-foreground')}>
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
          active === k ? 'bg-background/20' : 'bg-muted')}>{badge}</span>
      )}
    </Link>
  )
  return (
    <div className="mb-4 inline-flex gap-1 rounded-xl border bg-card p-1">
      {item('apercu', 'Vue d’ensemble')}
      {item('travaux', 'Travaux')}
      {item('agenda', 'Agenda')}
      {item('echeances', 'Échéances', deadlinesCount)}
    </div>
  )
}
