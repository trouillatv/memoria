'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

// Deux filtres, même barre : PAR CHANTIER et PAR ÉQUIPE. Ils restreignent ce
// qu'on lit sans changer la façon de le lire. Le focus jour se referme quand on
// filtre (le détail d'hier n'a plus de sens sous un nouveau périmètre).

export function MonthFilters({
  sites,
  teams,
  site,
  team,
}: {
  sites: { id: string; name: string }[]
  teams: { id: string; name: string }[]
  site: string
  team: string
}) {
  const router = useRouter()
  const params = useSearchParams()

  function update(key: 'site' | 'team', value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('focus')
    router.push(`/mois?${next.toString()}`)
  }

  return (
    <div className="flex items-center gap-2">
      <SelectPill label="chantier" value={site} onChange={(v) => update('site', v)} allLabel="Tous les chantiers" options={sites} />
      <SelectPill label="équipe" value={team} onChange={(v) => update('team', v)} allLabel="Toutes les équipes" options={teams} />
    </div>
  )
}

function SelectPill({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  allLabel: string
  options: { id: string; name: string }[]
}) {
  return (
    <div className="relative">
      <select
        aria-label={`Filtrer par ${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg border bg-card py-1.5 pl-3 pr-8 text-sm text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </div>
  )
}
