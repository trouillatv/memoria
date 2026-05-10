'use client'

import { useState } from 'react'
import { X, Plus, Sparkles, Flame } from 'lucide-react'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { resolveMode, modeLabel, MAX_AGENTS } from './copilote-mode'
import { AgentSelectorPopover } from './AgentSelectorPopover'
import { cn } from '@/lib/utils'
import type { ChatAgentName } from '@/types/db'

interface ModeCardProps {
  agents: ChatAgentName[]
  onChange: (agents: ChatAgentName[]) => void
}

export function ModeCard({ agents, onChange }: ModeCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const mode = resolveMode(agents)

  const removeAgent = (agent: ChatAgentName) => onChange(agents.filter((a) => a !== agent))

  const isDebate = mode === 'debate'
  const atCap = agents.length >= MAX_AGENTS

  return (
    <div className="relative">
      <div className={cn(
        'rounded-lg border p-3 mb-2 transition-colors',
        isDebate
          ? 'border-amber-300 bg-gradient-to-br from-amber-50/40 to-sky-50/40'
          : 'bg-muted/20'
      )}>
        {/* Header mode */}
        <div className="flex items-center gap-2 mb-2">
          {isDebate ? (
            <Flame className="h-4 w-4 text-amber-600" />
          ) : (
            <Sparkles className="h-4 w-4 text-slate-500" />
          )}
          <span className="text-sm font-semibold">
            {mode === 'empty' ? (
              <span>{modeLabel('empty')}</span>
            ) : (
              <>
                <span className="text-muted-foreground font-normal">Mode : </span>
                <span>{modeLabel(mode)}</span>
              </>
            )}
            {isDebate && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                · {agents.length} perspectives
              </span>
            )}
          </span>
        </div>

        {/* Chips participants */}
        {agents.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            {agents.map((agent) => {
              const meta = AGENTS[agent]
              const colors = AGENT_COLORS[agent]
              const Icon = meta.icon
              return (
                <span
                  key={agent}
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
                    onClick={() => removeAgent(agent)}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-black/5"
                    aria-label={`Retirer ${meta.label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* CTA add */}
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
            : agents.length === 0
              ? 'Sélectionner un agent'
              : 'Ajouter un agent'}
        </button>

        {/* Anticipation banner (mode debate) */}
        {isDebate && (
          <div className="mt-2 pt-2 border-t border-amber-200/60 text-[11px] text-amber-800 italic">
            ℹ Les agents donneront d&apos;abord leurs avis séparés, puis vous pourrez confronter leurs perspectives.
          </div>
        )}
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
