'use client'

// RM4 — trois questions, pas plus : OÙ · QUOI · QUAND.
//
// Ce sont les trois seules dont Guillaume dispose vraiment quand il cherche. Il
// ne sait ni qui a écrit la trace, ni dans quelle table elle dort.
//
// Chaque filtre affiche son COMPTE : « Observation 3 ». Un filtre qui ne dit pas
// combien il va garder oblige à l'essayer pour le savoir.

import Link from 'next/link'
import { X } from 'lucide-react'
import type { MemoryHitType } from '@/lib/db/memory-search'
import { HIT_LABEL_FR, PERIODS, ALL_MEMORY_DAYS } from '@/lib/memory/search-grouping'

export interface FilterState {
  q: string
  siteId: string | null
  type: MemoryHitType | null
  days: number
}

/** L'URL d'un filtre — on garde tout le reste. Le retour arrière du téléphone
 *  redéfait donc un filtre : c'est ce qu'on attend d'un écran de recherche. */
function href(state: FilterState, patch: Partial<FilterState>): string {
  const next = { ...state, ...patch }
  const p = new URLSearchParams({ q: next.q })
  if (next.siteId) p.set('site', next.siteId)
  if (next.type) p.set('type', next.type)
  if (next.days !== ALL_MEMORY_DAYS) p.set('days', String(next.days))
  return `/recherche?${p.toString()}`
}

function Chip({
  active,
  children,
  to,
}: {
  active: boolean
  children: React.ReactNode
  to: string
}) {
  return (
    <Link
      href={to}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'border-brand-300 bg-brand-100 font-medium text-brand-900'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      }`}
    >
      {children}
      {active && <X className="h-3 w-3" />}
    </Link>
  )
}

export function SearchFilters({
  state,
  types,
  sites,
}: {
  state: FilterState
  /** Les natures RÉELLEMENT présentes dans les résultats, avec leur compte. */
  types: Array<{ type: MemoryHitType; count: number }>
  /** Les chantiers RÉELLEMENT présents, avec leur compte. */
  sites: Array<{ id: string; name: string; count: number }>
}) {
  const filtered = state.siteId !== null || state.type !== null || state.days !== ALL_MEMORY_DAYS

  return (
    <div className="space-y-2">
      {/* QUOI — seulement les natures présentes : proposer un filtre vide serait
          promettre des résultats qui n'existent pas. */}
      {types.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {types.map(({ type, count }) => (
            <Chip
              key={type}
              active={state.type === type}
              to={href(state, { type: state.type === type ? null : type })}
            >
              {HIT_LABEL_FR[type]} <span className="tabular-nums opacity-70">{count}</span>
            </Chip>
          ))}
        </div>
      )}

      {/* OÙ */}
      {sites.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {sites.map((s) => (
            <Chip
              key={s.id}
              active={state.siteId === s.id}
              to={href(state, { siteId: state.siteId === s.id ? null : s.id })}
            >
              {s.name} <span className="tabular-nums opacity-70">{s.count}</span>
            </Chip>
          ))}
        </div>
      )}

      {/* QUAND — « Toute la mémoire » d'abord, parce que c'est le défaut : la
          question « on avait déjà vu ça ? » porte sur l'ancien. */}
      <div className="flex flex-wrap gap-1.5">
        {PERIODS.map((p) => (
          <Chip key={p.days} active={state.days === p.days} to={href(state, { days: p.days })}>
            {p.label}
          </Chip>
        ))}
      </div>

      {filtered && (
        <Link
          href={`/recherche?q=${encodeURIComponent(state.q)}`}
          className="inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Tout revoir
        </Link>
      )}
    </div>
  )
}
