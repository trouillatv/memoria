'use client'

import { useState } from 'react'
import { X, Plus, Sparkles, Flame, ChevronDown, ChevronUp } from 'lucide-react'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { resolveMode, MAX_AGENTS } from './copilote-mode'
import { AgentSelectorPopover } from './AgentSelectorPopover'
import { cn } from '@/lib/utils'
import type { ChatAgentName } from '@/types/db'

interface ModeCardProps {
  agents: ChatAgentName[]
  onChange: (agents: ChatAgentName[]) => void
}

const ALL_AGENTS: ChatAgentName[] = [
  'lecteur_ao', 'memoire_technique', 'contradicteur',
  'financier', 'terrain', 'conformite', 'general',
]

function AgentChip({
  agent,
  onRemove,
}: {
  agent: ChatAgentName
  onRemove: (agent: ChatAgentName) => void
}) {
  const meta = AGENTS[agent]
  const colors = AGENT_COLORS[agent]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full text-xs font-medium border',
        colors.borderClass, colors.textClass, colors.bgClass
      )}
    >
      <Icon className="h-3 w-3" />
      <span>{meta.label}</span>
      <button
        type="button"
        data-testid={`chip-remove-${agent}`}
        onClick={() => onRemove(agent)}
        className="ml-0.5 p-0.5 rounded-full hover:bg-black/5"
        aria-label={`Retirer ${meta.label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

export function ModeCard({ agents, onChange }: ModeCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [emptyExpanded, setEmptyExpanded] = useState(false)
  const mode = resolveMode(agents)
  const isDebate = mode === 'debate'
  const atCap = agents.length >= MAX_AGENTS

  const removeAgent = (agent: ChatAgentName) => onChange(agents.filter((a) => a !== agent))
  const addFromChip = (agent: ChatAgentName) => onChange([...agents, agent])

  // -------------------------------------------------------------------------
  // Empty state — compact bar by default. Tap "+ Choisir" or expand chevron.
  // The rail tooltips already convey each agent's signature question, so we
  // hide the verbose 7-chips grid behind an opt-in expand.
  // -------------------------------------------------------------------------
  if (mode === 'empty') {
    return (
      <div className="relative rounded-lg border bg-muted/20 p-3 mb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">À qui voulez-vous parler ?</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-testid="mode-empty-pick"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded text-foreground hover:bg-muted/50 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Choisir un expert
            </button>
            <button
              type="button"
              data-testid="mode-empty-expand"
              onClick={() => setEmptyExpanded((v) => !v)}
              aria-expanded={emptyExpanded}
              aria-label={emptyExpanded ? 'Masquer les experts' : 'Voir tous les experts'}
              className="p-1 rounded hover:bg-muted/50 text-muted-foreground"
            >
              {emptyExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {emptyExpanded && (
          <div className="mt-3 pt-3 border-t">
            <div className="text-xs text-muted-foreground mb-2">
              Sélectionnez 1 expert pour un avis · 2-3 pour un débat IA
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {ALL_AGENTS.map((agent) => {
                const meta = AGENTS[agent]
                const colors = AGENT_COLORS[agent]
                const Icon = meta.icon
                return (
                  <button
                    key={agent}
                    type="button"
                    data-testid={`mode-chip-${agent}`}
                    onClick={() => addFromChip(agent)}
                    className="flex items-start gap-2 p-2 rounded-lg border bg-card hover:border-foreground/30 hover:bg-muted/40 transition-colors text-left"
                  >
                    <div className={cn('shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5', colors.bgClass)}>
                      <Icon className={cn('h-3 w-3', colors.textClass)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium">{meta.label}</div>
                      <div className="text-[11px] text-muted-foreground italic line-clamp-1">
                        {meta.signatureQuestion}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <AgentSelectorPopover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selected={agents}
          onChange={onChange}
        />
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Expert mode — declarative "Vous consultez X"
  // -------------------------------------------------------------------------
  if (mode === 'expert' && agents[0]) {
    return (
      <div className="relative">
        <div className="rounded-lg border bg-muted/20 p-3 mb-2">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-slate-500 shrink-0" />
            <span className="text-sm font-semibold">Avis d&apos;expert</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mb-2 text-xs">
            <span className="text-muted-foreground">Vous consultez</span>
            <AgentChip agent={agents[0]} onRemove={removeAgent} />
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded text-foreground hover:bg-muted/50 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Ajouter un expert pour confronter
          </button>
        </div>

        <AgentSelectorPopover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selected={agents}
          onChange={onChange}
        />
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Debate mode — assertive "N perspectives vont confronter leurs analyses"
  // -------------------------------------------------------------------------
  return (
    <div className="relative">
      <div className="rounded-lg border border-amber-300 bg-gradient-to-br from-amber-50/40 to-sky-50/40 p-3 mb-2">
        <div className="flex items-center gap-2 mb-1">
          <Flame className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-sm font-semibold">Débat IA</span>
        </div>
        <div className="text-xs text-muted-foreground mb-2">
          {agents.length} perspectives vont confronter leurs analyses :
        </div>
        <div className="flex items-center gap-1 flex-wrap mb-2">
          {agents.map((agent, idx) => (
            <span key={agent} className="inline-flex items-center">
              <AgentChip agent={agent} onRemove={removeAgent} />
              {idx < agents.length - 1 && <span className="text-muted-foreground mx-0.5">·</span>}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={atCap}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded transition-colors',
            atCap
              ? 'text-muted-foreground cursor-not-allowed opacity-60'
              : 'text-foreground hover:bg-muted/50'
          )}
        >
          <Plus className="h-3 w-3" />
          {atCap
            ? `${MAX_AGENTS}/${MAX_AGENTS} — limite atteinte`
            : `Ajouter un expert — ${agents.length}/${MAX_AGENTS}`}
        </button>
      </div>

      <AgentSelectorPopover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selected={agents}
        onChange={onChange}
      />
    </div>
  )
}
