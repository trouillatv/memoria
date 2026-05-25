'use client'

// « + rattacher » sur la fiche document (#2). Ajoute un lien polymorphe
// (Contrat / Site / Client / AO / Équipe). Un doc = 1 nœud, N rattachements.
// addDocumentLink est idempotent → re-rattacher au même = no-op.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, X, Loader2 } from 'lucide-react'
import { addDocumentLinkAction } from '../actions'

type LinkOption = { id: string; label: string }
type LinkTargets = Record<string, LinkOption[]>

const TARGET_LABEL: Record<string, string> = {
  contract: 'Contrat', site: 'Site', client: 'Client', tender: 'AO', team: 'Équipe',
}
const selectCls = 'rounded-md border bg-background px-2 py-1.5 text-sm'

export function AddLinkToDocument({
  documentId,
  linkTargets,
}: {
  documentId: string
  linkTargets: LinkTargets
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [targetType, setTargetType] = useState('')
  const [targetId, setTargetId] = useState('')
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!targetType || !targetId) return
    startTransition(async () => {
      const fd = new FormData()
      fd.set('document_id', documentId)
      fd.set('target_type', targetType)
      fd.set('target_id', targetId)
      const r = await addDocumentLinkAction(fd)
      if (r.ok) {
        toast.success('Rattachement ajouté')
        setOpen(false)
        setTargetType('')
        setTargetId('')
        router.refresh()
      } else {
        toast.error(r.error ?? 'Échec')
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted/50 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Rattacher
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={targetType}
        onChange={(e) => { setTargetType(e.target.value); setTargetId('') }}
        disabled={pending}
        className={selectCls}
      >
        <option value="">Type…</option>
        {Object.keys(linkTargets).map((t) => (
          <option key={t} value={t}>{TARGET_LABEL[t] ?? t}</option>
        ))}
      </select>
      <select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        disabled={!targetType || pending}
        className={selectCls}
        key={targetType}
      >
        <option value="">{targetType ? 'Choisir…' : '—'}</option>
        {(linkTargets[targetType] ?? []).map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !targetType || !targetId}
        className="inline-flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-50 dark:bg-brand-950/30 dark:text-brand-200"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Rattacher
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setTargetType(''); setTargetId('') }}
        disabled={pending}
        className="p-1 rounded hover:bg-muted/50 text-muted-foreground"
        aria-label="Annuler"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
