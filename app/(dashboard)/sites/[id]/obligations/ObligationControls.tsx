'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, ShieldCheck, Bell } from 'lucide-react'
import { toast } from 'sonner'
import { FileDown } from 'lucide-react'
import {
  instantiateObligationsAction, materializeEngagementsAction, setObligationStatusAction,
  setObligationImportanceAction, setObligationResponsibleAction, markObligationRemindedAction,
} from './actions'
import type { ObligationStatus, ObligationImportance } from '@/lib/db/obligations'

type TemplateChoice = { id: string; label: string; themes: string[]; responsible: string }

const STATUS: { value: ObligationStatus; label: string }[] = [
  { value: 'a_produire', label: 'À produire' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'satisfaite', label: 'Satisfaite' },
  { value: 'non_applicable', label: 'Non applicable' },
]
const IMPORTANCE: ObligationImportance[] = ['critique', 'haute', 'moyenne']

/** Proposition de la bibliothèque standard — l'humain coche, MemorIA instancie. */
export function ProposeObligations({ siteId, choices }: { siteId: string; choices: TemplateChoice[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [sel, setSel] = useState<Set<string>>(new Set())

  if (choices.length === 0) return null
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  function add() {
    if (sel.size === 0) return
    const fd = new FormData()
    fd.set('siteId', siteId)
    for (const id of sel) fd.append('templateIds', id)
    start(async () => {
      const r = await instantiateObligationsAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(`${r.count ?? 0} obligation(s) ajoutée(s)`)
      setSel(new Set())
      router.refresh()
    })
  }

  return (
    <section className="space-y-3 rounded-xl border bg-muted/20 p-4">
      <div>
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-muted-foreground" /> Proposer les obligations standard</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">MemorIA propose la bibliothèque ; cochez celles qui s&apos;appliquent à ce chantier.</p>
      </div>
      <ul className="space-y-1">
        {choices.map((c) => (
          <li key={c.id}>
            <label className="flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-sm cursor-pointer hover:border-foreground/30">
              <input type="checkbox" checked={sel.has(c.id)} disabled={pending} onChange={() => toggle(c.id)} className="mt-1" />
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>
                <span className="block text-[11px] text-muted-foreground">{c.responsible}{c.themes.length ? ` · ${c.themes.join(', ')}` : ''}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button type="button" disabled={pending || sel.size === 0} onClick={add}
        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted/40 disabled:opacity-50">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Ajouter au chantier ({sel.size})
      </button>
    </section>
  )
}

/** Pont AO (Sprint B) : transforme les engagements validés du contrat en obligations
 *  vivantes, en conservant leur origine contractuelle (CCTP). L'humain déclenche. */
export function MaterializeEngagements({ siteId, count }: { siteId: string; count: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  if (count === 0) return null

  function run() {
    const fd = new FormData()
    fd.set('siteId', siteId)
    start(async () => {
      const r = await materializeEngagementsAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(`${r.count ?? 0} engagement(s) transformé(s) en obligations`)
      router.refresh()
    })
  }

  return (
    <section className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/40 p-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold"><FileDown className="h-4 w-4 text-sky-600" /> Engagements de l&apos;appel d&apos;offres</h2>
      <p className="text-xs text-muted-foreground">
        {count} engagement{count > 1 ? 's' : ''} validé{count > 1 ? 's' : ''} du dossier {count > 1 ? 'peuvent' : 'peut'} devenir
        des obligations suivies sur ce chantier — en gardant leur origine au CCTP (objectifs et pénalités exclus).
      </p>
      <button type="button" disabled={pending} onClick={run}
        className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-card px-2.5 py-1 text-xs font-medium hover:bg-sky-100/50 disabled:opacity-50">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} Transformer en obligations ({count})
      </button>
    </section>
  )
}

interface RowProps {
  siteId: string; obligationId: string
  status: ObligationStatus; importance: ObligationImportance; responsible: string
}

/** Contrôles d'une obligation : statut · criticité · responsable réel · relance. */
export function ObligationRowControls({ siteId, obligationId, status, importance, responsible }: RowProps) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editResp, setEditResp] = useState(false)
  const [respVal, setRespVal] = useState(responsible)

  const run = (fd: FormData, fn: (f: FormData) => Promise<{ ok: true } | { error: string }>, ok = 'Mis à jour') => {
    fd.set('siteId', siteId); fd.set('obligationId', obligationId)
    start(async () => {
      const r = await fn(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(ok); router.refresh()
    })
  }

  return (
    <div className="space-y-1.5">
      {/* Statut */}
      <div className="flex flex-wrap items-center gap-1">
        {STATUS.map((s) => {
          const fd = new FormData(); fd.set('status', s.value)
          return (
            <button key={s.value} type="button" disabled={pending} onClick={() => s.value !== status && run(fd, setObligationStatusAction)}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${s.value === status ? 'bg-foreground text-background' : 'bg-background hover:bg-muted/40'}`}>
              {s.label}
            </button>
          )
        })}
        {pending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      {/* Criticité · Responsable · Relance */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-muted-foreground">Criticité</span>
        <select value={importance} disabled={pending}
          onChange={(e) => { const fd = new FormData(); fd.set('importance', e.target.value); run(fd, setObligationImportanceAction) }}
          className="rounded border bg-background px-1.5 py-0.5">
          {IMPORTANCE.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <span className="text-muted-foreground">· Responsable</span>
        {editResp ? (
          <span className="inline-flex items-center gap-1">
            <input value={respVal} disabled={pending} onChange={(e) => setRespVal(e.target.value)} autoFocus
              className="rounded border bg-background px-1.5 py-0.5 max-w-[140px]"
              onKeyDown={(e) => { if (e.key === 'Enter' && respVal.trim()) { const fd = new FormData(); fd.set('responsible', respVal); run(fd, setObligationResponsibleAction); setEditResp(false) } }} />
            <button type="button" disabled={pending || !respVal.trim()} className="rounded border px-1.5 py-0.5 hover:bg-muted/40"
              onClick={() => { const fd = new FormData(); fd.set('responsible', respVal); run(fd, setObligationResponsibleAction); setEditResp(false) }}>OK</button>
          </span>
        ) : (
          <button type="button" className="rounded border px-1.5 py-0.5 font-medium hover:bg-muted/40" onClick={() => setEditResp(true)}>{responsible || '—'}</button>
        )}
        <button type="button" disabled={pending} onClick={() => run(new FormData(), markObligationRemindedAction, 'Relance enregistrée')}
          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-muted/40">
          <Bell className="h-3 w-3" /> Relancé
        </button>
      </div>
    </div>
  )
}
