'use client'

// Filtres de la liste « Toutes les missions » : par santé + par équipe.
// Server-driven via ?health= / ?team= — ce composant ne fait que mettre à jour
// l'URL (router.replace, scroll préservé). La page (RSC) re-filtre côté serveur.
// Pas de JS lourd : des chips santé + un <select> équipe natif.

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

type Health = 'all' | 'red' | 'orange' | 'green'

const HEALTH_CHIPS: Array<{ value: Health; label: string; dot: string; activeCls: string }> = [
  { value: 'all', label: 'Toutes', dot: '', activeCls: 'bg-foreground text-background border-foreground' },
  { value: 'red', label: 'Critique', dot: '🔴', activeCls: 'bg-red-500 text-white border-red-500' },
  { value: 'orange', label: 'À surveiller', dot: '🟠', activeCls: 'bg-amber-500 text-white border-amber-500' },
  { value: 'green', label: 'En rythme', dot: '🟢', activeCls: 'bg-emerald-500 text-white border-emerald-500' },
]

export function MissionFilters({
  health,
  team,
  teams,
  hasSansEquipe,
  counts,
}: {
  health: Health
  team: string
  teams: Array<{ id: string; name: string }>
  hasSansEquipe: boolean
  counts: { green: number; orange: number; red: number }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(sp.toString())
      if (value === 'all') next.delete(key)
      else next.set(key, value)
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [sp, pathname, router],
  )

  const countFor = (v: Health) =>
    v === 'red' ? counts.red : v === 'orange' ? counts.orange : v === 'green' ? counts.green : null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {HEALTH_CHIPS.map((chip) => {
        const active = health === chip.value
        const n = countFor(chip.value)
        // On masque un niveau de santé sans aucune mission (sauf « Toutes »).
        if (chip.value !== 'all' && n === 0) return null
        return (
          <button
            key={chip.value}
            type="button"
            onClick={() => setParam('health', chip.value)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-transform active:scale-[0.97] ${
              active
                ? chip.activeCls
                : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30'
            }`}
          >
            {chip.dot && <span className="text-[10px] leading-none">{chip.dot}</span>}
            {chip.label}
            {n !== null && <span className="opacity-60 tabular-nums">{n}</span>}
          </button>
        )
      })}

      {(teams.length > 0 || hasSansEquipe) && (
        <select
          value={team}
          onChange={(e) => setParam('team', e.target.value)}
          aria-label="Filtrer par équipe"
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
            team !== 'all'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30'
          }`}
        >
          <option value="all">Toutes les équipes</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          {hasSansEquipe && <option value="none">Sans équipe</option>}
        </select>
      )}
    </div>
  )
}
