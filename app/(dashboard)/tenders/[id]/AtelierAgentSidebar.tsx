'use client'

import { useState } from 'react'
import { CheckCircle2, AlertTriangle, Loader2, Play } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { runAgentInitialAnalysisAction } from './atelier-actions'
import { toast } from 'sonner'
import { AGENTS } from './agents-metadata'
import type { DbAgentAnalysis, ChatAgentName, AgentAnalysisStatus } from '@/types/db'

const STATUS_LABEL: Record<AgentAnalysisStatus, string> = {
  pending: 'Pas encore analysé',
  running: 'Analyse en cours…',
  ready:   'Analyse prête',
  failed:  'Échec',
}

function StatusIcon({ status }: { status: AgentAnalysisStatus }) {
  if (status === 'running') return <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
  if (status === 'ready')   return <CheckCircle2 className="h-3 w-3 text-emerald-600" />
  if (status === 'failed')  return <AlertTriangle className="h-3 w-3 text-rose-600" />
  return <span className="h-3 w-3 rounded-full bg-muted-foreground/30 inline-block" />
}

export function AtelierAgentSidebar({
  tenderId,
  analyses: initialAnalyses,
}: {
  tenderId: string
  analyses: DbAgentAnalysis[]
}) {
  // analyses Map keyed by agent_name pour un lookup O(1)
  const [analyses, setAnalyses] = useState<Map<ChatAgentName, DbAgentAnalysis>>(
    () => new Map(initialAnalyses.map((a) => [a.agent_name, a]))
  )
  const [pending, setPending] = useState<Set<ChatAgentName>>(new Set())

  async function handleRun(agent: ChatAgentName) {
    if (pending.has(agent)) return
    setPending((prev) => new Set(prev).add(agent))

    // Optimistic : mark as running localement
    setAnalyses((prev) => {
      const next = new Map(prev)
      const existing = next.get(agent)
      next.set(agent, {
        ...(existing ?? {
          id: 'temp',
          tender_id: tenderId,
          agent_name: agent,
          summary: null,
          key_points: null,
          raw_content: null,
          metadata: null,
          error_msg: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        status: 'running',
      } as DbAgentAnalysis)
      return next
    })

    const fd = new FormData()
    fd.set('tender_id', tenderId)
    fd.set('agent_name', agent)
    const r = await runAgentInitialAnalysisAction(fd)
    setPending((prev) => {
      const next = new Set(prev)
      next.delete(agent)
      return next
    })
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
      // Revert optimistic
      setAnalyses((prev) => {
        const next = new Map(prev)
        const existing = next.get(agent)
        if (existing) next.set(agent, { ...existing, status: 'pending' })
        return next
      })
    } else {
      toast.success(`Analyse ${AGENTS[agent].label} lancée — patientez quelques secondes`)
      // Note : le status réel passera de 'running' à 'ready' quand le `after()` server termine.
      // Pour l'instant on garde l'état 'running' optimiste. L'utilisateur doit refresh la page
      // pour voir 'ready' (ou on pourrait poller — mais pour MVP, refresh manuel).
    }
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Agents IA
        </div>
        {(Object.keys(AGENTS) as ChatAgentName[]).map((agentKey) => {
          const meta = AGENTS[agentKey]
          const Icon = meta.icon
          const analysis = analyses.get(agentKey)
          const status = analysis?.status ?? 'pending'
          const isPending = pending.has(agentKey)
          const hasRisks = analysis?.key_points && typeof analysis.key_points === 'object'
            && Array.isArray((analysis.key_points as Record<string, unknown>).risks)
            && ((analysis.key_points as Record<string, unknown>).risks as unknown[]).length > 0

          return (
            <div
              key={agentKey}
              className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/40 transition-colors"
            >
              <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{meta.label}</span>
                  <StatusIcon status={status} />
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{meta.description}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className="text-[10px] py-0 h-4"
                  >
                    {STATUS_LABEL[status]}
                  </Badge>
                  {hasRisks && (
                    <Badge className="text-[10px] py-0 h-4 bg-amber-100 text-amber-800 border-amber-200">
                      Risque détecté
                    </Badge>
                  )}
                </div>
                {(status === 'pending' || status === 'failed') && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] mt-1"
                    onClick={() => handleRun(agentKey)}
                    disabled={isPending}
                  >
                    <Play className="h-2.5 w-2.5 mr-1" />
                    Lancer l&apos;analyse
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
