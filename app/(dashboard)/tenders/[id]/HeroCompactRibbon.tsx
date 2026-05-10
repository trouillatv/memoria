'use client'

import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { SUGGESTED_PROMPTS } from './CopiloteHeroCard'
import type { ChatAgentName, DbAgentAnalysis } from '@/types/db'

interface HeroCompactRibbonProps {
  agentAnalyses: DbAgentAnalysis[]
  onPromptClick: (prompt: string, agents: ChatAgentName[]) => void
}

export function HeroCompactRibbon({ agentAnalyses, onPromptClick }: HeroCompactRibbonProps) {
  const [overlayOpen, setOverlayOpen] = useState(false)

  const total = 7
  const ready = agentAnalyses.filter((a) => a.status === 'ready').length
  const running = agentAnalyses.filter((a) => a.status === 'running').length
  const generated = agentAnalyses.filter((a) => a.status !== 'pending').length
  const toGenerate = total - generated

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b -mx-3 px-3 py-2 mb-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-3 w-3 text-emerald-600 shrink-0" />
          <span className="font-medium truncate">{total} experts</span>
          <span className="text-muted-foreground truncate">
            · {ready} prêts · {running} en cours · {toGenerate} à générer
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOverlayOpen(true)}
          className="text-xs text-foreground hover:underline whitespace-nowrap shrink-0"
        >
          Voir suggestions ▼
        </button>
      </div>

      {overlayOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOverlayOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Suggestions de prompts"
            className="absolute right-3 top-full mt-1 z-50 w-[380px] max-w-[calc(100vw-1.5rem)] rounded-lg border bg-popover shadow-xl p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Allez plus loin</h4>
              <button
                type="button"
                onClick={() => setOverlayOpen(false)}
                className="p-0.5 rounded hover:bg-muted"
                aria-label="Fermer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-1.5">
              {SUGGESTED_PROMPTS.map((p) => {
                const Icon = p.icon
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => { onPromptClick(p.prompt, p.agents); setOverlayOpen(false) }}
                    className="w-full flex items-start gap-2 p-2 rounded border bg-card hover:bg-muted/40 text-left"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{p.prompt}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
