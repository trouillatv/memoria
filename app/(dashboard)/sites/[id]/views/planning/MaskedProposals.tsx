'use client'

// ── MASQUÉES — À VÉRIFIER ─────────────────────────────────────────────────────
// Propositions d'échéances filtrées par le moteur de suppression (bad_extraction).
// Jamais supprimées silencieusement : l'utilisateur peut décider de les remettre
// en attente de validation si le filtre avait tort.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { EyeOff, Undo2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { DbKnowledgeProposal } from '@/lib/db/knowledge-proposals'
import { unmaskDeadlineProposalAction } from './deadline-actions'

export function MaskedProposals({ items }: { items: DbKnowledgeProposal[] }) {
  return (
    <details className="mt-4 rounded-2xl border border-dashed border-amber-200 bg-amber-50/20 dark:border-amber-900/40 dark:bg-amber-950/10">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 marker:content-none">
        <EyeOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Masquées — à vérifier ({items.length})
        </span>
        <span className="text-[11.5px] text-amber-700/70 dark:text-amber-300/60">
          Filtrées par MemorIA · Cliquez pour inspecter
        </span>
      </summary>
      <ul className="space-y-2 px-4 pb-4 pt-2">
        {items.map((p) => <MaskedItem key={p.id} proposal={p} />)}
      </ul>
    </details>
  )
}

function MaskedItem({ proposal }: { proposal: DbKnowledgeProposal }) {
  const router = useRouter()
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()

  function unmask() {
    start(async () => {
      const res = await unmaskDeadlineProposalAction(proposal.id)
      if (res.ok) {
        setDone(true)
        router.refresh()
        toast.success('Proposition remise en attente de validation')
      } else {
        toast.error(res.error)
      }
    })
  }

  if (done) return null

  return (
    <li className="flex items-start justify-between gap-3 border-t pt-2 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm text-foreground/80">{proposal.title}</p>
        {proposal.body && (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{proposal.body}</p>
        )}
      </div>
      <button
        type="button"
        onClick={unmask}
        disabled={pending}
        title="Remettre en attente de validation"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
        Proposer quand même
      </button>
    </li>
  )
}
