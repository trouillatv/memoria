'use client'

import { useState } from 'react'
import { Loader2, AlertCircle, Eye, Sparkles, RotateCw, ChevronRight, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { runAgentInitialAnalysisAction } from './atelier-actions'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { Tooltip } from './Tooltip'
import { AgentActionPopover, type ActionKind } from './AgentActionPopover'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ChatAgentName, DbAgentAnalysis, AgentAnalysisStatus } from '@/types/db'

const AGENT_ORDER: ChatAgentName[] = [
  'lecteur_ao', 'memoire_technique', 'contradicteur',
  'financier', 'terrain', 'conformite', 'general',
]

interface AgentPanelProps {
  tenderId: string
  analyses: DbAgentAnalysis[]
  onView: (agentName: ChatAgentName) => void
  expanded: boolean
  onToggleExpanded: () => void
}

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  const min = Math.floor(diff / 60000)
  if (min < 1)  return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24)   return `il y a ${h} h`
  const days = Math.floor(h / 24)
  return `il y a ${days} j`
}

function keyPointsCount(analysis: DbAgentAnalysis): number {
  const kp = analysis.key_points
  if (!kp) return 0
  if (Array.isArray((kp as { items?: unknown[] }).items)) return ((kp as { items: unknown[] }).items).length
  return Object.keys(kp).length
}

function statusLabel(status: AgentAnalysisStatus | null): string {
  switch (status) {
    case 'ready':   return '✓ Prête'
    case 'running': return '⚙ En cours'
    case 'failed':  return '⚠ Erreur'
    case 'pending': return '— À générer'
    default:        return '— À générer'
  }
}

interface PopoverState {
  agent: ChatAgentName
  kind: ActionKind
}

export function AgentPanel({ tenderId, analyses, onView, expanded, onToggleExpanded }: AgentPanelProps) {
  const [pendingAgents, setPendingAgents] = useState<Set<ChatAgentName>>(new Set())
  const [popover, setPopover] = useState<PopoverState | null>(null)

  const byAgent = new Map<ChatAgentName, DbAgentAnalysis>()
  for (const a of analyses) byAgent.set(a.agent_name, a)

  async function generate(agentName: ChatAgentName) {
    if (pendingAgents.has(agentName)) return
    setPendingAgents((prev) => new Set(prev).add(agentName))
    const fd = new FormData()
    fd.set('tender_id', tenderId)
    fd.set('agent_name', agentName)
    const r = await runAgentInitialAnalysisAction(fd)
    setPendingAgents((prev) => {
      const next = new Set(prev)
      next.delete(agentName)
      return next
    })
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
    } else {
      toast.success(`Analyse ${AGENTS[agentName].label} lancée`)
    }
  }

  function handleRailIconClick(agent: ChatAgentName, status: AgentAnalysisStatus | null) {
    // Strict separation: icon = agent action (NEVER expand layout)
    if (status === 'ready') {
      onView(agent)
      return
    }
    if (status === 'running') {
      // No-op: tooltip suffices
      return
    }
    // not_generated / pending / failed → popover
    const kind: ActionKind = status === 'failed' ? 'failed' : 'pending'
    setPopover({ agent, kind })
  }

  // ---------------------------------------------------------------------------
  // Collapsed rail (default state — 56px wide)
  // ---------------------------------------------------------------------------
  if (!expanded) {
    return (
      <aside className="w-full md:w-14 shrink-0">
        <div className="flex md:flex-col gap-1 p-1 rounded-lg border bg-card">
          {AGENT_ORDER.map((agent) => {
            const meta = AGENTS[agent]
            const colors = AGENT_COLORS[agent]
            const Icon = meta.icon
            const analysis = byAgent.get(agent)
            const status = analysis?.status ?? null
            const isLocallyPending = pendingAgents.has(agent)
            const effectiveStatus: AgentAnalysisStatus | null = isLocallyPending ? 'running' : status
            const isPopoverOpen = popover?.agent === agent

            return (
              <div key={agent} className="relative inline-flex">
                <Tooltip
                  content={`${meta.label}\n« ${meta.signatureQuestion} »\n${statusLabel(effectiveStatus)}`}
                  side="right"
                >
                  <button
                    type="button"
                    data-testid={`rail-icon-${agent}`}
                    onClick={() => handleRailIconClick(agent, effectiveStatus)}
                    aria-label={`${meta.label} : ${statusLabel(effectiveStatus)}`}
                    className={cn(
                      'relative w-12 h-12 rounded-md flex items-center justify-center transition-colors',
                      colors.bgClass, 'hover:opacity-80'
                    )}
                  >
                    <Icon className={cn('h-5 w-5', colors.textClass)} />
                    {effectiveStatus === 'ready' && (
                      <span
                        className={cn('absolute top-1 right-1 w-2 h-2 rounded-full ring-1 ring-background', colors.dotClass)}
                        aria-hidden
                      />
                    )}
                    {effectiveStatus === 'running' && (
                      <Loader2 className="absolute top-0.5 right-0.5 h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
                    )}
                    {effectiveStatus === 'failed' && (
                      <AlertCircle className="absolute top-0.5 right-0.5 h-3 w-3 text-rose-500" aria-hidden />
                    )}
                  </button>
                </Tooltip>
                {isPopoverOpen && popover && (
                  <AgentActionPopover
                    open={true}
                    agent={agent}
                    kind={popover.kind}
                    loading={isLocallyPending}
                    onAction={() => generate(agent)}
                    onOpenChange={(open) => { if (!open) setPopover(null) }}
                  />
                )}
              </div>
            )
          })}
          <button
            type="button"
            data-testid="rail-expand"
            onClick={onToggleExpanded}
            className="w-12 h-8 rounded-md flex items-center justify-center hover:bg-muted/50 mt-1 border-t pt-1 text-muted-foreground"
            aria-label="Développer le panneau des analyses persistées"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </aside>
    )
  }

  // ---------------------------------------------------------------------------
  // Expanded panel (320px wide)
  // ---------------------------------------------------------------------------
  return (
    <aside className="w-full md:w-[320px] shrink-0 space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-semibold">Analyses persistées</h2>
        </div>
        <button
          type="button"
          data-testid="rail-collapse"
          onClick={onToggleExpanded}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
          title="Réduire en rail"
          aria-label="Réduire le panneau"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="space-y-2">
        {AGENT_ORDER.map((agent) => {
          const meta = AGENTS[agent]
          const colors = AGENT_COLORS[agent]
          const Icon = meta.icon
          const analysis = byAgent.get(agent)
          const status = analysis?.status ?? null
          const isLocallyPending = pendingAgents.has(agent)
          const effectiveStatus: AgentAnalysisStatus | null = isLocallyPending ? 'running' : status

          return (
            <li
              key={agent}
              className={cn(
                'rounded-lg border p-3 bg-card transition-colors',
                effectiveStatus === 'ready' && 'border-l-4',
                effectiveStatus === 'ready' && colors.borderClass
              )}
            >
              <div className="flex items-start gap-2 mb-1.5">
                <div className={cn('shrink-0 w-7 h-7 rounded-full flex items-center justify-center', colors.bgClass)}>
                  <Icon className={cn('h-3.5 w-3.5', colors.textClass)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{meta.label}</div>
                  <div className="text-[11px] text-muted-foreground italic mb-0.5 line-clamp-1">
                    {meta.signatureQuestion}
                  </div>
                  {(effectiveStatus === null || effectiveStatus === 'pending') && (
                    <div className="text-xs text-muted-foreground">— Pas encore générée</div>
                  )}
                  {effectiveStatus === 'running' && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Génération en cours…
                    </div>
                  )}
                  {effectiveStatus === 'ready' && analysis && (
                    <div className="text-xs text-muted-foreground">
                      ✓ Prête · {keyPointsCount(analysis)} findings
                      <div className="mt-0.5">
                        {formatRelative(analysis.updated_at)}
                        {analysis.metadata && typeof analysis.metadata === 'object' && 'provider' in analysis.metadata && (
                          <> · <span className="font-mono">{String((analysis.metadata as { provider?: string }).provider ?? '')}</span></>
                        )}
                      </div>
                    </div>
                  )}
                  {effectiveStatus === 'failed' && (
                    <div className="flex items-center gap-1 text-xs text-rose-600">
                      <AlertCircle className="h-3 w-3" /> Erreur de génération
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-1">
                {(effectiveStatus === null || effectiveStatus === 'pending') && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => generate(agent)}
                    disabled={isLocallyPending}
                  >
                    Générer l&apos;analyse
                  </Button>
                )}
                {effectiveStatus === 'ready' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onView(agent)}
                  >
                    <Eye className="h-3 w-3 mr-1" /> Voir l&apos;analyse
                  </Button>
                )}
                {effectiveStatus === 'failed' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => generate(agent)}
                    disabled={isLocallyPending}
                  >
                    <RotateCw className="h-3 w-3 mr-1" /> Réessayer
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
