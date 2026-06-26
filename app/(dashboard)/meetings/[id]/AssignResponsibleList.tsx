'use client'

// Bucket « Sans responsable » de la vue « Par responsable » — rendu ACTIONNABLE.
// Coordination : on attribue un responsable (champ libre, comme la curation des
// actions), jamais une évaluation. Une fois attribuée, l'action quitte ce bucket
// (refresh serveur) et rejoint son groupe responsable.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserX, Check, Loader2 } from 'lucide-react'
import { updateActionAction } from './action-curation-actions'

export function AssignResponsibleList({
  reportId,
  actions,
  suggestions,
}: {
  reportId: string
  actions: Array<{ id: string; title: string }>
  suggestions: string[]
}) {
  if (actions.length === 0) return null
  const listId = `resp-${reportId}`
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
      <p className="inline-flex items-center gap-2 text-sm font-medium text-amber-900">
        <UserX className="h-4 w-4 text-amber-600" /> Sans responsable — {actions.length} à attribuer
      </p>
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
      <ul className="space-y-1.5">
        {actions.map((a) => (
          <AssignRow key={a.id} reportId={reportId} action={a} listId={listId} />
        ))}
      </ul>
    </div>
  )
}

function AssignRow({
  reportId,
  action,
  listId,
}: {
  reportId: string
  action: { id: string; title: string }
  listId: string
}) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function save() {
    const v = value.trim()
    if (!v) return
    setError(null)
    start(async () => {
      const res = await updateActionAction(reportId, action.id, { assigned_to: v })
      if (res.ok) {
        setHidden(true) // sort du bucket immédiatement…
        router.refresh() // …puis le serveur recalcule les groupes.
      } else {
        setError(res.error ?? 'Échec')
      }
    })
  }

  if (hidden) return null
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate">{action.title}</span>
      <input
        list={listId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        placeholder="Responsable…"
        className="w-40 rounded border px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending || !value.trim()}
        className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Attribuer
      </button>
      {error && <span className="w-full text-xs text-rose-700">{error}</span>}
    </li>
  )
}
