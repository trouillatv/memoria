'use client'

// Slice B.0 — Filtre période compact pour le Dossier de preuves.
//
// Doctrine UX :
//   - 2 inputs <date> (Du / Au) qui synchronisent dateFrom / dateTo dans l'URL.
//   - Raccourcis 1-clic (Aujourd'hui / 7 derniers jours / 30 derniers jours /
//     Ce mois / Mois précédent) : le DG vient avec une question floue
//     « mardi dernier », il ne veut pas calculer une date.
//   - Pas de validation crochue : si on tape une date hors plage, la requête
//     retournera juste un empty state — c'est OK.
//   - Toute action reset la pagination (`page`).

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

interface ShortcutDef {
  key: string
  label: string
  compute: (today: Date) => { from: string; to: string }
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function endOfMonth(d: Date): Date {
  // Le jour 0 du mois suivant = dernier jour du mois courant.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
}

const SHORTCUTS: ShortcutDef[] = [
  {
    key: 'today',
    label: "Aujourd'hui",
    compute: (today) => ({ from: toIso(today), to: toIso(today) }),
  },
  {
    key: '7d',
    label: '7 derniers jours',
    compute: (today) => {
      const from = new Date(today)
      from.setUTCDate(from.getUTCDate() - 6)
      return { from: toIso(from), to: toIso(today) }
    },
  },
  {
    key: '30d',
    label: '30 derniers jours',
    compute: (today) => {
      const from = new Date(today)
      from.setUTCDate(from.getUTCDate() - 29)
      return { from: toIso(from), to: toIso(today) }
    },
  },
  {
    key: 'thisMonth',
    label: 'Ce mois-ci',
    compute: (today) => ({
      from: toIso(startOfMonth(today)),
      to: toIso(endOfMonth(today)),
    }),
  },
  {
    key: 'prevMonth',
    label: 'Mois précédent',
    compute: (today) => {
      const refPrev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15))
      return {
        from: toIso(startOfMonth(refPrev)),
        to: toIso(endOfMonth(refPrev)),
      }
    },
  },
]

export function DateRangeFilter() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()

  const dateFrom = params.get('dateFrom') ?? ''
  const dateTo = params.get('dateTo') ?? ''

  function pushParams(next: { from?: string | null; to?: string | null }) {
    const sp = new URLSearchParams(params.toString())
    if (next.from === null) sp.delete('dateFrom')
    else if (next.from !== undefined) sp.set('dateFrom', next.from)
    if (next.to === null) sp.delete('dateTo')
    else if (next.to !== undefined) sp.set('dateTo', next.to)
    sp.delete('page')
    const qs = sp.toString()
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  function applyShortcut(key: string) {
    const sc = SHORTCUTS.find((s) => s.key === key)
    if (!sc) return
    const today = new Date()
    // Normalise UTC à minuit pour cohérence iso.
    const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    const { from, to } = sc.compute(t)
    pushParams({ from, to })
  }

  function handleFromChange(value: string) {
    pushParams({ from: value || null })
  }
  function handleToChange(value: string) {
    pushParams({ to: value || null })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-slot="date-range-filter">
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground whitespace-nowrap">Du</span>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => handleFromChange(e.target.value)}
          className="h-8 rounded-lg border border-input bg-background px-2 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="date-range-from"
          aria-label="Date de début"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground whitespace-nowrap">Au</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => handleToChange(e.target.value)}
          className="h-8 rounded-lg border border-input bg-background px-2 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="date-range-to"
          aria-label="Date de fin"
        />
      </label>
      <select
        aria-label="Raccourcis période"
        value=""
        onChange={(e) => {
          const v = e.target.value
          if (v) applyShortcut(v)
        }}
        className="h-8 rounded-lg border border-input bg-background px-2 py-1 text-sm text-muted-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        data-testid="date-range-shortcuts"
      >
        <option value="">Raccourcis…</option>
        {SHORTCUTS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  )
}
