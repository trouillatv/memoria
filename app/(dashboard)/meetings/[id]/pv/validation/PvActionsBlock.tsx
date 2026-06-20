'use client'

// Bloc ACTIONS du CR — Ajouter / Modifier / Supprimer (Vincent : l'entité la plus
// fréquente ; « dans 80 % des cas, Émeline ajoute »). Écrit la SOURCE (site_actions)
// → une seule vérité, ressert partout (briefing, recherche, pilier Actions).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X, Trash2, Plus, Loader2, ListTodo } from 'lucide-react'
import { addActionAction, editActionAction, deleteActionAction } from '../../pv-actions'

export interface ActionRow {
  id: string
  title: string
  assignedTo: string
  dueDate: string // AAAA-MM-JJ ou ''
  corpsEtat: string
}

type Res = { ok: true } | { ok: false; error: string }

function Row({ reportId, action }: { reportId: string; action: ActionRow }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(action.title)
  const [who, setWho] = useState(action.assignedTo)
  const [due, setDue] = useState(action.dueDate)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(fn: () => Promise<Res>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try { const r = await fn(); if (r.ok) { onOk?.(); router.refresh() } else setError(r.error) }
      catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  return (
    <li className="rounded-lg border bg-card px-3 py-2 text-sm">
      {editing ? (
        <div className="space-y-1.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intitulé de l'action" autoFocus
            className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          <div className="flex flex-wrap gap-2">
            <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Responsable"
              className="min-w-[8rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
            <input value={due} onChange={(e) => setDue(e.target.value)} type="date"
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending || !title.trim()} onClick={() => run(() => editActionAction(reportId, action.id, { title, assignedTo: who, dueDate: due }), () => setEditing(false))}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer
            </button>
            <button type="button" disabled={pending} onClick={() => { setTitle(action.title); setWho(action.assignedTo); setDue(action.dueDate); setEditing(false); setError(null) }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /> Annuler</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <span className="min-w-0 flex-1">
            {action.title}
            {(action.assignedTo || action.dueDate) && (
              <span className="block text-[11px] text-muted-foreground">
                {action.assignedTo}{action.assignedTo && action.dueDate ? ' · ' : ''}{action.dueDate ? `échéance ${action.dueDate}` : ''}
              </span>
            )}
          </span>
          <button type="button" disabled={pending} title="Modifier" onClick={() => setEditing(true)} className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={pending} title="Supprimer" onClick={() => run(() => deleteActionAction(reportId, action.id))} className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </li>
  )
}

function AddAction({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [who, setWho] = useState('')
  const [due, setDue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    setError(null)
    startTransition(async () => {
      try {
        const r = await addActionAction(reportId, { title, assignedTo: who, dueDate: due })
        if (r.ok) { setTitle(''); setWho(''); setDue(''); setOpen(false); router.refresh() }
        else setError(r.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted/40">
      <Plus className="h-4 w-4" /> Ajouter une action
    </button>
  )
  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intitulé (ex. « Relancer SudÉlec pour le tableau »)" autoFocus
        className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      <div className="flex flex-wrap items-center gap-2">
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Responsable"
          className="min-w-[8rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <input value={due} onChange={(e) => setDue(e.target.value)} type="date"
          className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <button type="button" disabled={pending || !title.trim()} onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
        </button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null) }} className="text-sm text-muted-foreground hover:text-foreground">Annuler</button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  )
}

export function PvActionsBlock({ reportId, actions }: { reportId: string; actions: ActionRow[] }) {
  return (
    <section className="space-y-2">
      <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <ListTodo className="h-3.5 w-3.5" /> Actions ({actions.length})
      </h2>
      {actions.length > 0 && (
        <ul className="space-y-1">{actions.map((a) => <Row key={a.id} reportId={reportId} action={a} />)}</ul>
      )}
      <AddAction reportId={reportId} />
    </section>
  )
}
