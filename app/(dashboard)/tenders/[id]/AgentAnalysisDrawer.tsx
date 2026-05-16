'use client'

import { useState } from 'react'
import { X, RotateCw, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { runAgentInitialAnalysisAction } from './atelier-actions'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { DbAgentAnalysis } from '@/types/db'

interface AgentAnalysisDrawerProps {
  open: boolean
  analysis: DbAgentAnalysis | null
  tenderId: string
  onOpenChange: (open: boolean) => void
}

function formatTokens(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null
  const inT = typeof meta.input_tokens === 'number' ? meta.input_tokens : 0
  const outT = typeof meta.output_tokens === 'number' ? meta.output_tokens : 0
  const total = inT + outT
  if (total === 0) return null
  return `${total.toLocaleString('fr-FR')} tokens`
}

export function AgentAnalysisDrawer({ open, analysis, tenderId, onOpenChange }: AgentAnalysisDrawerProps) {
  const [regenerating, setRegenerating] = useState(false)

  if (!open || !analysis) return null

  const meta = AGENTS[analysis.agent_name]
  const colors = AGENT_COLORS[analysis.agent_name]
  const Icon = meta.icon
  const provider = analysis.metadata && typeof analysis.metadata === 'object' && 'provider' in analysis.metadata
    ? String((analysis.metadata as { provider?: string }).provider ?? '')
    : null
  const tokensLabel = formatTokens(analysis.metadata as Record<string, unknown> | null)

  const keyPoints: string[] = (() => {
    const kp = analysis.key_points
    if (!kp) return []
    if (Array.isArray((kp as { items?: unknown[] }).items)) {
      return ((kp as { items: unknown[] }).items)
        .filter((x): x is string => typeof x === 'string')
    }
    return []
  })()

  function handleDownload() {
    if (!analysis) return
    const lines: string[] = []
    lines.push(`# Analyse — ${meta.label}`)
    lines.push(`_Générée le ${new Date(analysis.updated_at).toLocaleString('fr-FR')}_`)
    lines.push('')
    if (analysis.summary) {
      lines.push('## Synthèse')
      lines.push(analysis.summary)
      lines.push('')
    }
    if (keyPoints.length > 0) {
      lines.push('## Points clés')
      keyPoints.forEach(p => lines.push(`- ${p}`))
      lines.push('')
    }
    if (analysis.raw_content?.trim()) {
      lines.push('## Analyse complète')
      lines.push(analysis.raw_content)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analyse-${analysis.agent_name}-${new Date(analysis.updated_at).toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleRegenerate() {
    if (!analysis) return
    setRegenerating(true)
    const fd = new FormData()
    fd.set('tender_id', tenderId)
    fd.set('agent_name', analysis.agent_name)
    const r = await runAgentInitialAnalysisAction(fd)
    setRegenerating(false)
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
    } else {
      toast.success(`Régénération ${meta.label} lancée`)
      onOpenChange(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={`Analyse ${meta.label}`}
        className={cn(
          'fixed right-0 top-0 z-50 h-full w-full sm:w-[480px] bg-background shadow-xl',
          'flex flex-col border-l overflow-hidden'
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <div className={cn('shrink-0 w-7 h-7 rounded-full flex items-center justify-center', colors.bgClass)}>
            <Icon className={cn('h-3.5 w-3.5', colors.textClass)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">{meta.label}</div>
            <div className="text-[11px] text-muted-foreground">Analyse persistée</div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-1 rounded hover:bg-muted"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Synthèse</h3>
            <div className="text-sm whitespace-pre-wrap">{analysis.summary ?? '_(pas de synthèse)_'}</div>
          </section>

          {keyPoints.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Points clés</h3>
              <ul className="text-sm space-y-1">
                {keyPoints.map((p, i) => (
                  <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span><span>{p}</span></li>
                ))}
              </ul>
            </section>
          )}

          {/* Analyse complète — raw_content contient le texte intégral de l'agent */}
          {analysis.raw_content && analysis.raw_content.trim().length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Analyse complète</h3>
              <div className="rounded-lg border bg-muted/20 px-3 py-3 text-sm whitespace-pre-wrap leading-relaxed font-mono text-xs">
                {analysis.raw_content}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Métadonnées</h3>
            <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Générée :</dt>
              <dd>{new Date(analysis.updated_at).toLocaleString('fr-FR')}</dd>
              {provider && (<>
                <dt className="text-muted-foreground">Provider :</dt>
                <dd className="font-mono">{provider}</dd>
              </>)}
              {tokensLabel && (<>
                <dt className="text-muted-foreground">Coût :</dt>
                <dd>{tokensLabel}</dd>
              </>)}
            </dl>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownload}
          >
            <Download className="h-3 w-3 mr-1" />
            Sauvegarder
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={regenerating}
            onClick={handleRegenerate}
          >
            <RotateCw className={cn('h-3 w-3 mr-1', regenerating && 'animate-spin')} />
            Régénérer l&apos;analyse
          </Button>
        </div>
      </div>
    </>
  )
}
