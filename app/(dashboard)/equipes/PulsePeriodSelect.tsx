'use client'

// Dropdown de période pour le bloc Mémoire terrain — même mécanisme que
// MissionFilters.tsx (URL searchParam `period`, router.replace, pas de state
// client, la page RSC re-fetch côté serveur).

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { PULSE_PERIOD_VALUES, DEFAULT_PULSE_PERIOD, type PulsePeriod } from '@/lib/db/pulse-period'

const PERIOD_LABEL: Record<PulsePeriod, string> = {
  '7': '7 derniers jours',
  '30': '30 derniers jours',
  '90': '3 derniers mois',
}

export function PulsePeriodSelect({ period }: { period: PulsePeriod }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    const next = new URLSearchParams(sp.toString())
    if (value === DEFAULT_PULSE_PERIOD) next.delete('period')
    else next.set('period', value)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <select
      value={period}
      onChange={onChange}
      aria-label="Période de la mémoire terrain"
      className="rounded-md border border-input bg-transparent px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      {PULSE_PERIOD_VALUES.map((v) => (
        <option key={v} value={v}>
          {PERIOD_LABEL[v]}
        </option>
      ))}
    </select>
  )
}
