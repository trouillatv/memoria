'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { MAX_AGENTS } from './copilote-mode'
import { getAgentAvgCostsAction } from './atelier-actions'
import { formatXpf } from '@/lib/format/currency'
import { cn } from '@/lib/utils'
import type { ChatAgentName } from '@/types/db'

type AvgCost = { avgUsd: number | null; count: number }

interface AgentSelectorPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: ChatAgentName[]
  onChange: (agents: ChatAgentName[]) => void
}

const ALL_AGENTS: ChatAgentName[] = [
  'lecteur_ao', 'memoire_technique', 'contradicteur',
  'financier', 'terrain', 'conformite', 'general',
]

export function AgentSelectorPopover({ open, onOpenChange, selected, onChange }: AgentSelectorPopoverProps) {
  const [query, setQuery] = useState('')
  const [avgCosts, setAvgCosts] = useState<Record<string, AvgCost> | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Coût IA moyen observé par agent — chargé à la 1ʳᵉ ouverture (responsabilise
  // avant de lancer). Silencieux si échec : l'absence de chiffre n'empêche rien.
  useEffect(() => {
    if (!open || avgCosts !== null) return
    let alive = true
    getAgentAvgCostsAction()
      .then((c) => { if (alive) setAvgCosts(c) })
      .catch(() => { if (alive) setAvgCosts({}) })
    return () => { alive = false }
  }, [open, avgCosts])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open, onOpenChange])

  if (!open) return null

  function toggle(agent: ChatAgentName) {
    if (selected.includes(agent)) {
      onChange(selected.filter((a) => a !== agent))
    } else {
      if (selected.length >= MAX_AGENTS) return
      onChange([...selected, agent])
    }
  }

  const filtered = ALL_AGENTS.filter((a) => {
    const meta = AGENTS[a]
    const q = query.toLowerCase()
    return meta.label.toLowerCase().includes(q) || meta.description.toLowerCase().includes(q)
  })

  return (
    <div
      ref={ref}
      className="absolute z-20 bottom-full mb-2 w-[360px] rounded-lg border bg-popover shadow-lg overflow-hidden"
      role="dialog"
      aria-label="Sélectionner les agents"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un agent…"
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      <ul className="max-h-72 overflow-y-auto py-1">
        {filtered.map((agent) => {
          const meta = AGENTS[agent]
          const colors = AGENT_COLORS[agent]
          const Icon = meta.icon
          const isSelected = selected.includes(agent)
          const wouldExceed = !isSelected && selected.length >= MAX_AGENTS
          return (
            <li key={agent}>
              <button
                type="button"
                role="option"
                aria-checked={isSelected}
                disabled={wouldExceed}
                data-testid={`agent-row-${agent}`}
                onClick={() => toggle(agent)}
                className={cn(
                  'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
                  isSelected ? 'bg-accent/60' : 'hover:bg-muted/40',
                  wouldExceed && 'opacity-40 cursor-not-allowed'
                )}
              >
                <div className={cn('shrink-0 w-6 h-6 rounded-full flex items-center justify-center', colors.bgClass)}>
                  <Icon className={cn('h-3 w-3', colors.textClass)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{meta.label}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{meta.description}</div>
                  {avgCosts && (() => {
                    const c = avgCosts[agent]
                    if (c && c.count > 0 && typeof c.avgUsd === 'number') {
                      return (
                        <div className="text-[11px] text-muted-foreground/80 mt-0.5">
                          ≈ {formatXpf(c.avgUsd)} / analyse · moyenne sur {c.count}
                        </div>
                      )
                    }
                    return (
                      <div className="text-[11px] text-muted-foreground/50 mt-0.5">
                        coût mesuré dès la 1ʳᵉ analyse
                      </div>
                    )
                  })()}
                </div>
                {isSelected && <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t bg-muted/20">
        {selected.length}/{MAX_AGENTS} sélectionnés
      </div>
    </div>
  )
}
