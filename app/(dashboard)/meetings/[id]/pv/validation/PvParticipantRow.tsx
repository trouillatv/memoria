'use client'

// Participant éditable (#5 « Modifier la mémoire ») : nom + organisme + PRÉSENCE.
// La présence n'est PAS un choix unique : statut Présent/Absent (P/AE/AN) + cases
// INDÉPENDANTES Invité (I) et Diffusion (D) — comme les colonnes BECIB. Écrit la
// SOURCE (site_reports.participants).
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X, Loader2, Trash2, Plus } from 'lucide-react'
import { editParticipantAction, removeParticipantAction, addParticipantAction } from '../../pv-actions'
import type { ParticipantPresence } from '@/types/db'

type Res = { ok: true } | { ok: false; error: string }

const STATUTS: { value: ParticipantPresence; label: string }[] = [
  { value: 'P', label: 'Présent' },
  { value: 'AE', label: 'Absent excusé' },
  { value: 'AN', label: 'Absent non excusé' },
]

function PresenceFields({
  pres, setPres, inv, setInv, diff, setDiff, disabled,
}: {
  pres: ParticipantPresence; setPres: (v: ParticipantPresence) => void
  inv: boolean; setInv: (v: boolean) => void
  diff: boolean; setDiff: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select value={pres} disabled={disabled} onChange={(e) => setPres(e.target.value as ParticipantPresence)}
        className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-60">
        {STATUTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={inv} disabled={disabled} onChange={(e) => setInv(e.target.checked)} /> Invité</label>
      <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={diff} disabled={disabled} onChange={(e) => setDiff(e.target.checked)} /> Diffusion</label>
    </div>
  )
}

function Badges({ presence, invite, diffusion }: { presence: ParticipantPresence; invite: boolean; diffusion: boolean }) {
  const items = [invite ? 'I' : null, presence, diffusion ? 'D' : null].filter(Boolean) as string[]
  return (
    <span className="shrink-0 flex gap-1">
      {items.map((c) => <span key={c} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{c}</span>)}
    </span>
  )
}

export interface ContactOption { id: string; label: string }

export function PvParticipantRow({
  reportId, index, name, role, presence, invite, diffusion, contactId, contacts = [],
}: {
  reportId: string; index: number; name: string; role: string
  presence: ParticipantPresence; invite: boolean; diffusion: boolean
  contactId?: string; contacts?: ContactOption[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [n, setN] = useState(name)
  const [r, setR] = useState(role)
  const [pres, setPres] = useState<ParticipantPresence>(presence)
  const [inv, setInv] = useState(invite)
  const [diff, setDiff] = useState(diffusion)
  const [ct, setCt] = useState(contactId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const editStartRef = useRef<number>(0) // début d'édition → temps de correction (mig 140)
  const linkedLabel = contactId ? contacts.find((c) => c.id === contactId)?.label : null

  function run(fn: () => Promise<Res>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try { const res = await fn(); if (res.ok) { onOk?.(); router.refresh() } else setError(res.error) }
      catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }
  const save = () => run(() => editParticipantAction(reportId, index, n, r, pres, inv, diff, ct || null, editStartRef.current ? Date.now() - editStartRef.current : null), () => setEditing(false))
  const resetAndClose = () => { setN(name); setR(role); setPres(presence); setInv(invite); setDiff(diffusion); setCt(contactId ?? ''); setEditing(false); setError(null) }

  return (
    <li className="rounded-lg border bg-card px-3 py-2 text-sm">
      {editing ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Nom / représentant" autoFocus
              className="min-w-[9rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
            <input value={r} onChange={(e) => setR(e.target.value)} placeholder="Organisme (ex. SudÉlec)"
              className="min-w-[9rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          </div>
          <PresenceFields pres={pres} setPres={setPres} inv={inv} setInv={setInv} diff={diff} setDiff={setDiff} disabled={pending} />
          {/* Lien OPTIONNEL vers un contact réel du casting (souplesse : « non lié » possible). */}
          {contacts.length > 0 && (
            <select value={ct} disabled={pending} onChange={(e) => setCt(e.target.value)} title="Contact réel (casting du chantier)"
              className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-60">
              <option value="">Contact réel — non lié</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending || !n.trim()} onClick={save}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer
            </button>
            <button type="button" disabled={pending} onClick={resetAndClose} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /> Annuler</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            {name}{role ? <span className="text-muted-foreground"> — {role}</span> : null}
            {linkedLabel && <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" title="Lié à un contact réel">🔗 {linkedLabel}</span>}
          </span>
          <Badges presence={presence} invite={invite} diffusion={diffusion} />
          <button type="button" disabled={pending} title="Modifier (corrige la mémoire)" onClick={() => { editStartRef.current = Date.now(); setEditing(true) }}
            className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={pending} title="Retirer ce participant" onClick={() => run(() => removeParticipantAction(reportId, index))}
            className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
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
  const [pres, setPres] = useState<ParticipantPresence>('P')
  const [inv, setInv] = useState(true)
  const [diff, setDiff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await addParticipantAction(reportId, n, r, pres, inv, diff)
        if (res.ok) { setN(''); setR(''); setPres('P'); setInv(true); setDiff(false); setOpen(false); router.refresh() }
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
    <div className="space-y-1.5 rounded-lg border bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Nom / représentant" autoFocus
          className="min-w-[9rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <input value={r} onChange={(e) => setR(e.target.value)} placeholder="Organisme"
          className="min-w-[9rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      </div>
      <PresenceFields pres={pres} setPres={setPres} inv={inv} setInv={setInv} diff={diff} setDiff={setDiff} disabled={pending} />
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending || !n.trim()} onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
        </button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null) }} className="text-sm text-muted-foreground hover:text-foreground">Annuler</button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  )
}
