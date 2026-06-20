'use client'

// Points STRUCTURÉS ajoutés en séance (mig 134) : anomalie / prévision saisies par
// Émeline quand le terrain n'a rien remonté. Objets TYPÉS (≠ texte libre des
// remarques) → l'anomalie va dans Points examinés, la prévision dans Prévisions.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2, AlertTriangle, CalendarClock } from 'lucide-react'
import { addAnomalieAction, addPrevisionAction, deleteAddedPointAction } from '../../pv-actions'
import type { ReportAddedPoint } from '@/lib/db/report-added-points'

const ANOMALIE_STATUTS = ['bloqué', 'en cours', 'à faire', 'en attente'] as const

type Res = { ok: true } | { ok: false; error: string }

function useRun() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  function run(fn: () => Promise<Res>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (res.ok) { onOk?.(); router.refresh() }
        else setError(res.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }
  return { run, pending, error }
}

function AddAnomalie({ reportId }: { reportId: string }) {
  const { run, pending, error } = useRun()
  const [label, setLabel] = useState('')
  const [statut, setStatut] = useState<(typeof ANOMALIE_STATUTS)[number]>('bloqué')
  return (
    <div className="space-y-1 rounded-lg border bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Anomalie constatée (ex. « fissure en sous-face dalle R+1 »)"
          className="min-w-[14rem] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <select value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
          {ANOMALIE_STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" disabled={pending || !label.trim()}
          onClick={() => run(() => addAnomalieAction(reportId, { label, statut }), () => setLabel(''))}
          className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Anomalie
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  )
}

function AddPrevision({ reportId }: { reportId: string }) {
  const { run, pending, error } = useRun()
  const [label, setLabel] = useState('')
  const [who, setWho] = useState('')
  const [due, setDue] = useState('')
  const [confiance, setConfiance] = useState<'sûr' | 'à confirmer'>('sûr')
  return (
    <div className="space-y-1 rounded-lg border bg-card p-2">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Prévision (ex. « Réception des menuiseries extérieures »)"
        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      <div className="flex flex-wrap items-center gap-2">
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Responsable"
          className="min-w-[7rem] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <input value={due} onChange={(e) => setDue(e.target.value)} type="date"
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        {/* Fiabilité (Vincent) : une prévision porte sa confiance, c'est une donnée. */}
        <select value={confiance} onChange={(e) => setConfiance(e.target.value as typeof confiance)}
          title="Fiabilité de la prévision"
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
          <option value="sûr">confirmée</option>
          <option value="à confirmer">à confirmer</option>
        </select>
        <button type="button" disabled={pending || !label.trim()}
          onClick={() => run(() => addPrevisionAction(reportId, { label, assignedTo: who, dueDate: due, confiance }), () => { setLabel(''); setWho(''); setDue(''); setConfiance('sûr') })}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Prévision
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  )
}

function Row({ reportId, point }: { reportId: string; point: ReportAddedPoint }) {
  const { run, pending } = useRun()
  const det = point.kind === 'prevision'
    ? [point.assignedTo, point.dueDate].filter(Boolean).join(' · ')
    : point.statut
  const Icon = point.kind === 'anomalie' ? AlertTriangle : CalendarClock
  return (
    <li className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${point.kind === 'anomalie' ? 'text-rose-600' : 'text-sky-600'}`} />
      <span className="min-w-0 flex-1">
        {point.label}
        {det && <span className="block text-[11px] text-muted-foreground">{det}</span>}
      </span>
      {point.kind === 'prevision' && point.confiance === 'à confirmer' && (
        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">à confirmer</span>
      )}
      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
        {point.kind === 'anomalie' ? 'anomalie' : 'prévision'}
      </span>
      <button type="button" disabled={pending} title="Supprimer" onClick={() => run(() => deleteAddedPointAction(reportId, point.id))}
        className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50">
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}

export function PvAddedPoints({ reportId, points }: { reportId: string; points: ReportAddedPoint[] }) {
  return (
    <section className="space-y-2">
      <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Plus className="h-3.5 w-3.5" /> Ajouter en séance — anomalie / prévision ({points.length})
      </h2>
      {points.length > 0 && (
        <ul className="space-y-1">{points.map((p) => <Row key={p.id} reportId={reportId} point={p} />)}</ul>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <AddAnomalie reportId={reportId} />
        <AddPrevision reportId={reportId} />
      </div>
    </section>
  )
}
