'use client'

// Participant éditable (#5 « Modifier la mémoire ») : corriger nom + organisme écrit
// la SOURCE (site_reports.participants). Une seule vérité — pas d'override local au CR.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X, Loader2, Trash2, Plus } from 'lucide-react'
import { editParticipantAction, removeParticipantAction, addParticipantAction } from '../../pv-actions'

export function PvParticipantRow({
  reportId, index, name, role,
}: { reportId: string; index: number; name: string; role: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [n, setN] = useState(name)
  const [r, setR] = useState(role)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try { const res = await fn(); if (res.ok) { onOk?.(); router.refresh() } else setError(res.error) }
      catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }
  const save = () => run(() => editParticipantAction(reportId, index, n, r), () => setEditing(false))

  return (
    <li className="rounded-lg border bg-card px-3 py-2 text-sm">
      {editing ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Nom / représentant" autoFocus
              className="min-w-[10rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
            <input value={r} onChange={(e) => setR(e.target.value)} placeholder="Organisme (ex. SudÉlec)"
              className="min-w-[10rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending || !n.trim()} onClick={save}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer
            </button>
            <button type="button" disabled={pending} onClick={() => { setN(name); setR(role); setEditing(false); setError(null) }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" /> Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1">{name}{role ? <span className="text-muted-foreground"> — {role}</span> : null}</span>
          <button type="button" disabled={pending} title="Modifier (corrige la mémoire)" onClick={() => setEditing(true)}
            className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={pending} title="Retirer ce participant" onClick={() => run(() => removeParticipantAction(reportId, index))}
            className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </li>
  )
}

export function AddParticipant({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [n, setN] = useState('')
  const [r, setR] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await addParticipantAction(reportId, n, r)
        if (res.ok) { setN(''); setR(''); setOpen(false); router.refresh() }
        else setError(res.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted/40">
      <Plus className="h-4 w-4" /> Ajouter un participant
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Nom / représentant" autoFocus
        className="min-w-[9rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      <input value={r} onChange={(e) => setR(e.target.value)} placeholder="Organisme"
        className="min-w-[9rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      <button type="button" disabled={pending || !n.trim()} onClick={add}
        className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
      </button>
      <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null) }} className="text-sm text-muted-foreground hover:text-foreground">Annuler</button>
      {error && <p className="w-full text-xs text-rose-600">{error}</p>}
    </div>
  )
}
