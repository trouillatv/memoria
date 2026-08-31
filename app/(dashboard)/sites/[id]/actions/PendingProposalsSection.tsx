'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Pencil, ChevronRight, Sparkles, Loader2 } from 'lucide-react'
import type { PendingActionProposal } from '@/lib/knowledge/site-pending-proposals'
import { confirmActionProposalAction, dismissActionProposalAction } from '@/app/(dashboard)/actions/actions'

/**
 * Propositions d'action détectées par MemorIA — gérées SUR PLACE (P0-1).
 *
 * Doctrine : « L'objet métier se gère là où il vit. Sa source explique
 * pourquoi il existe, mais n'est jamais un passage obligé pour le gérer. »
 * Confirmer / Modifier puis confirmer / Écarter sont ici, directement.
 * « Voir la visite source » reste un lien SECONDAIRE (la preuve), jamais le
 * chemin obligé de la décision.
 */
export function PendingProposalsSection({
  proposals,
  siteId,
}: {
  proposals: PendingActionProposal[]
  siteId: string
}) {
  const [handled, setHandled] = useState<Set<string>>(new Set())
  const visible = proposals.filter((p) => !handled.has(p.id))
  if (visible.length === 0) return null

  return (
    <section
      id="propositions"
      className="scroll-mt-4 rounded-xl border border-sky-200 bg-sky-50/50 p-4 shadow-sm dark:border-sky-900/40 dark:bg-sky-950/20"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-sky-600" aria-hidden />
        <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-200">
          {visible.length} proposition{visible.length > 1 ? 's' : ''} à confirmer
        </h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Détectées par MemorIA, en attente de votre décision.
      </p>
      <ul className="mt-3 space-y-2">
        {visible.map((p) => (
          <ProposalRow
            key={p.id}
            proposal={p}
            siteId={siteId}
            onHandled={() => setHandled((s) => new Set(s).add(p.id))}
          />
        ))}
      </ul>
    </section>
  )
}

function ProposalRow({
  proposal,
  siteId,
  onHandled,
}: {
  proposal: PendingActionProposal
  siteId: string
  onHandled: () => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(proposal.title)
  const [body, setBody] = useState(proposal.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const meta = [proposal.provenanceLabel, proposal.provenanceDate].filter(Boolean).join(' · ')

  function confirm() {
    setError(null)
    startTransition(async () => {
      const res = await confirmActionProposalAction({
        proposalId: proposal.id,
        siteId,
        titleOverride: editing && title.trim() !== proposal.title ? title.trim() : undefined,
        bodyOverride: editing && body.trim() !== (proposal.body ?? '') ? body.trim() : undefined,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      onHandled()
      router.refresh()
    })
  }

  function dismiss() {
    setError(null)
    startTransition(async () => {
      const res = await dismissActionProposalAction({ proposalId: proposal.id, siteId })
      if (!res.ok) {
        setError(res.error)
        return
      }
      onHandled()
      router.refresh()
    })
  }

  return (
    <li className="rounded-lg border border-sky-100 bg-background px-3 py-2.5 dark:border-sky-900/30">
      {editing ? (
        <div className="space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Titre de l'action"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Détail (optionnel)"
            className="w-full rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Détail de l'action"
          />
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground/90">{proposal.title}</p>
          {proposal.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{proposal.body}</p>}
        </>
      )}

      {(meta || proposal.owner || proposal.canonicalSubjectLabel) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
          {meta && <span>{meta}</span>}
          {proposal.owner && <span>· {proposal.owner}</span>}
          {proposal.canonicalSubjectLabel && <span>· {proposal.canonicalSubjectLabel}</span>}
        </div>
      )}

      {error && <p className="mt-1 text-[11.5px] text-rose-600">{error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={pending || (editing && !title.trim())}
          onClick={confirm}
          className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-100 px-2 py-1 text-[12px] font-medium text-sky-900 hover:bg-sky-200 disabled:opacity-50 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          Confirmer
        </button>
        {!editing && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Modifier
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={dismiss}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Écarter
        </button>
        {proposal.reportHref && (
          <Link
            href={proposal.reportHref}
            className="ml-auto inline-flex items-center gap-0.5 text-[11.5px] text-muted-foreground hover:text-foreground hover:underline"
          >
            Voir la visite source <ChevronRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>
    </li>
  )
}
