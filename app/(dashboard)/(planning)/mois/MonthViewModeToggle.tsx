'use client'

// Le même geste que dans la Semaine : Chantier × Jour primaire, Équipe × Jour
// secondaire, l'URL comme seule source de vérité (`?view=team`). Un seul
// planning, plusieurs axes de lecture — pas deux mondes séparés.

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { cn } from '@/lib/utils'
import { parseViewMode, formatViewMode, type WeekViewMode } from '../semaine/view-mode-storage'

export function MonthViewModeToggle({ mode }: { mode: WeekViewMode }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function go(next: WeekViewMode) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    const formatted = formatViewMode(next)
    if (formatted === null) params.delete('view')
    else params.set('view', formatted)
    const qs = params.toString()
    startTransition(() => router.push(qs.length > 0 ? `/mois?${qs}` : '/mois'))
  }

  return (
    <div
      role="group"
      aria-label="Axe de lecture du mois"
      data-testid="month-view-mode-toggle"
      className={cn('inline-flex rounded-lg border bg-card p-0.5 text-xs', pending && 'opacity-60')}
    >
      {(['site', 'team'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => go(parseViewMode(value))}
          className={cn(
            'rounded-md px-2.5 py-1 transition-colors',
            mode === value
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {value === 'site' ? 'Par chantier' : 'Par équipe'}
        </button>
      ))}
    </div>
  )
}
