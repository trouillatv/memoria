'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { EyeOff, Undo2, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { DbKnowledgeProposal } from '@/lib/db/knowledge-proposals'
import { unmaskDeadlineProposalAction, deleteSuppressionRuleAction } from './deadline-actions'

export function MaskedProposals({ items }: { items: DbKnowledgeProposal[] }) {
  if (items.length === 0) return null
  return (
    <details className="mt-4 rounded-2xl border border-dashed border-amber-200 bg-amber-50/20 dark:border-amber-900/40 dark:bg-amber-950/10">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 marker:content-none">
        <EyeOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Masqu&eacute;es &mdash; &agrave; v&eacute;rifier ({items.length})
        </span>
        <span className="text-[11.5px] text-amber-700/70 dark:text-amber-300/60">
          Filtr&eacute;es par Memor&iacute;A &middot; Cliquez pour inspecter
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
  const [pendingUnmask, startUnmask] = useTransition()
  const [pendingDelete, startDelete] = useTransition()

  function unmask() {
    startUnmask(async () => {
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

  function deleteRule() {
    startDelete(async () => {
      const res = await deleteSuppressionRuleAction(proposal.id)
      if (res.ok) {
        setDone(true)
        router.refresh()
        toast.success('Règle supprimée — la proposition est remise en attente')
      } else {
        toast.error(res.error)
      }
    })
  }

  if (done) return null

  const busy = pendingUnmask || pendingDelete

  return (
    <li className="flex items-start justify-between gap-3 border-t pt-2 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm text-foreground/80">{proposal.title}</p>
        {proposal.body && (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{proposal.body}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button
          type="button"
          onClick={unmask}
          disabled={busy}
          title="Proposer quand m&ecirc;me (la r&egrave;gle reste active)"
          className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          {pendingUnmask ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
          Proposer quand m&ecirc;me
        </button>
        <button
          type="button"
          onClick={deleteRule}
          disabled={busy}
          title="Supprimer la r&egrave;gle de m&eacute;moire"
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-background px-2.5 py-1.5 text-[12px] font-medium text-red-700 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/20 disabled:opacity-50"
        >
          {pendingDelete ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Supprimer la r&egrave;gle
        </button>
      </div>
    </li>
  )
}
