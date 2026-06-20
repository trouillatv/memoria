'use client'

// Participant éditable (#5 « Modifier la mémoire ») : corriger nom + organisme écrit
// la SOURCE (site_reports.participants). Une seule vérité — pas d'override local au CR.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X, Loader2 } from 'lucide-react'
import { editParticipantAction } from '../../pv-actions'

export function PvParticipantRow({
  reportId, index, name, role,
}: { reportId: string; index: number; name: string; role: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [n, setN] = useState(name)
  const [r, setR] = useState(role)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await editParticipantAction(reportId, index, n, r)
        if (res.ok) { setEditing(false); router.refresh() }
        else setError(res.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

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
          <button type="button" title="Modifier (corrige la mémoire)" onClick={() => setEditing(true)}
            className="shrink-0 text-muted-foreground hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </li>
  )
}
