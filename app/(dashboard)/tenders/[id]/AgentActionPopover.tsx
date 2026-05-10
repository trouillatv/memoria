'use client'

import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AGENTS } from './agents-metadata'
import type { ChatAgentName } from '@/types/db'

export type ActionKind = 'pending' | 'failed'

interface AgentActionPopoverProps {
  open: boolean
  agent: ChatAgentName
  kind: ActionKind
  loading?: boolean
  onAction: () => void
  onOpenChange: (open: boolean) => void
}

export function AgentActionPopover({
  open,
  agent,
  kind,
  loading = false,
  onAction,
  onOpenChange,
}: AgentActionPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

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

  const meta = AGENTS[agent]
  const message = kind === 'pending'
    ? "Cette analyse n'a pas encore été générée."
    : "L'analyse précédente est en erreur."
  const cta = kind === 'pending' ? "Générer l'analyse" : 'Réessayer'

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Action analyse ${meta.label}`}
      data-testid={`action-popover-${agent}`}
      className="absolute z-30 left-full top-0 ml-2 w-[260px] rounded-lg border bg-popover shadow-xl p-3"
    >
      <div className="text-xs font-semibold mb-0.5">{meta.label}</div>
      <div className="text-[11px] text-muted-foreground italic mb-1.5 line-clamp-2">
        {meta.signatureQuestion}
      </div>
      <div className="text-xs text-muted-foreground mb-2">{message}</div>
      <Button
        type="button"
        size="sm"
        className="w-full h-7 text-xs"
        disabled={loading}
        onClick={() => { onAction(); onOpenChange(false) }}
      >
        {loading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
        {cta}
      </Button>
    </div>
  )
}
