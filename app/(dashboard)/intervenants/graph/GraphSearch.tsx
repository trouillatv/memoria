'use client'

// ── RECHERCHE + FOCUS ────────────────────────────────────────────────────────
// Taper « Joseph » → le graphe centre l'acteur, le sélectionne, ouvre l'inspecteur
// et met son voisinage en évidence (la sélection fait le reste, cf. useGraphExplorer).
// La liste ne propose que des acteurs RÉELLEMENT présents dans la vue courante.

import { useState } from 'react'
import { Search } from 'lucide-react'
import { KIND_LAYER_LABEL, type ActorGraphNode } from '@/lib/knowledge/actors-graph-model'

export function GraphSearch({ query, onQuery, matches, onPick }: {
  query: string
  onQuery: (q: string) => void
  matches: ActorGraphNode[]
  onPick: (id: string) => void
}) {
  const [active, setActive] = useState(0)
  const open = query.trim().length > 0 && matches.length > 0

  const pick = (id: string) => { onPick(id); setActive(0) }

  return (
    <div className="relative w-full max-w-xs">
      <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 focus-within:border-brand-300">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="text"
          value={query}
          onChange={(e) => { onQuery(e.target.value); setActive(0) }}
          onKeyDown={(e) => {
            if (!open) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); const m = matches[active]; if (m) pick(m.id) }
            else if (e.key === 'Escape') { e.preventDefault(); onQuery('') }
          }}
          placeholder="Rechercher un acteur…"
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          aria-label="Rechercher un acteur dans le graphe"
        />
      </div>

      {open && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border/60 bg-card py-1 shadow-lg">
          {matches.map((n, i) => (
            <li key={n.id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(n.id) }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] ${i === active ? 'bg-muted' : ''}`}
              >
                <span className="truncate">{n.label}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{KIND_LAYER_LABEL[n.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
