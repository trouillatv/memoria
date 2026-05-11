'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface FilterSelectOption {
  value: string
  label: string
}

interface FilterSelectProps {
  /** Nom du searchParam URL synchronisé. */
  paramName: string
  /** Label visible à gauche du <select>. */
  label: string
  /** Options proposées (en plus de l'option vide « tous »). */
  options: FilterSelectOption[]
  /** Label de l'option vide (default 'Tous'). */
  emptyLabel?: string
  className?: string
}

/**
 * Dropdown sobre basé sur le <select> natif (accessible, mobile-friendly,
 * sans dépendance combobox custom). Synchronise sa valeur avec un searchParam URL.
 *
 * Toute modification reset également la pagination (param `page`).
 */
export function FilterSelect({
  paramName,
  label,
  options,
  emptyLabel = 'Tous',
  className,
}: FilterSelectProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const value = params.get(paramName) ?? ''

  function handleChange(newValue: string) {
    const next = new URLSearchParams(params.toString())
    if (newValue) next.set(paramName, newValue)
    else next.delete(paramName)
    next.delete('page')
    const qs = next.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <label
      className={cn('flex items-center gap-2 text-sm', className)}
      data-slot="filter-select"
    >
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="h-8 rounded-lg border border-input bg-background px-2 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        data-testid={`filter-select-${paramName}`}
      >
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
