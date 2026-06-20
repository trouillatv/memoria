'use client'

// DÉCISIONS (mig 136) — « on a décidé que… ». L'objet le plus durable d'un CR :
// mémoire du site, ni action ni prévision. Saisie + cycle de vie (actée → appliquée
// → caduque/contredite) ici même ; la décision est PROJETÉE dans le CR (Points
// administratifs) via le spine, pas dans un écran parallèle. MVP : ajout = human/sûr/actée.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Gavel, Pencil, Check, X, Trash2, Plus, Loader2 } from 'lucide-react'
import { addDecisionAction, editDecisionAction, deleteDecisionAction } from '../../pv-actions'
import { ACTION_CODES } from '@/lib/db/action-codes'
import { DECISION_STATUTS, DECISION_IMPACTS, STATUT_LABEL, IMPACT_LABEL, type DecisionImpact } from '@/lib/db/decision-constants'
import type { SiteDecision } from '@/lib/db/site-decisions'

type Res = { ok: true } | { ok: false; error: string }

// Cycle de vie pertinent à piloter à la main (proposée = réservé extraction IA).
const STATUTS_HUMAINS = DECISION_STATUTS.filter((s) => s !== 'proposee')

function ddmmyyyy(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

function Row({ reportId, d }: { reportId: string; d: SiteDecision }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [titre, setTitre] = useState(d.titre)
  const [desc, setDesc] = useState(d.description ?? '')
  const [sujet, setSujet] = useState(d.sujet ?? '')
  const [role, setRole] = useState(d.decisionnaireRole ?? '')
  const [impact, setImpact] = useState<DecisionImpact | ''>(d.impact ?? '')
  const [ech, setEch] = useState(d.echeance ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(fn: () => Promise<Res>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try { const r = await fn(); if (r.ok) { onOk?.(); router.refresh() } else setError(r.error) }
      catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  const meta = [d.sujet, d.decisionnaireOrg || d.decisionnaireRole, d.impact ? IMPACT_LABEL[d.impact] : null, ddmmyyyy(d.echeance) ? `éch. ${ddmmyyyy(d.echeance)}` : null].filter(Boolean).join(' · ')

  return (
    <li className="rounded-lg border bg-card px-3 py-2 text-sm">
      {editing ? (
        <div className="space-y-1.5">
          <input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Décision prise" autoFocus
            className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Détail (optionnel)"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          <div className="flex flex-wrap gap-2">
            <input value={sujet} onChange={(e) => setSujet(e.target.value)} placeholder="Sujet (ex. « revêtement »)"
              className="min-w-[8rem] flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
            <select value={role} onChange={(e) => setRole(e.target.value)} title="Décisionnaire"
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
              <option value="">Décisionnaire…</option>
              {ACTION_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={impact} onChange={(e) => setImpact(e.target.value as DecisionImpact | '')} title="Impact"
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
              <option value="">Impact…</option>
              {DECISION_IMPACTS.map((i) => <option key={i} value={i}>{IMPACT_LABEL[i]}</option>)}
            </select>
            <input value={ech} onChange={(e) => setEch(e.target.value)} type="date" title="Échéance d'application"
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending || !titre.trim()}
              onClick={() => run(() => editDecisionAction(reportId, d.id, { titre, description: desc, sujet, decisionnaireRole: role, impact: impact || '', echeance: ech }), () => setEditing(false))}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer
            </button>
            <button type="button" disabled={pending} onClick={() => { setTitre(d.titre); setDesc(d.description ?? ''); setSujet(d.sujet ?? ''); setRole(d.decisionnaireRole ?? ''); setImpact(d.impact ?? ''); setEch(d.echeance ?? ''); setEditing(false); setError(null) }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /> Annuler</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <span className="min-w-0 flex-1">
            <span className={d.statut === 'caduque' || d.statut === 'contredite' ? 'text-muted-foreground line-through' : ''}>{d.titre}</span>
            {d.description && <span className="block text-[11px] text-muted-foreground">{d.description}</span>}
            {meta && <span className="block text-[11px] text-muted-foreground">{meta}</span>}
          </span>
          {/* Cycle de vie piloté à la main (la mémoire vivante : appliquée / caduque…). */}
          <select value={d.statut} disabled={pending} title="Statut de la décision"
            onChange={(e) => run(() => editDecisionAction(reportId, d.id, { statut: e.target.value as SiteDecision['statut'] }))}
            className="shrink-0 rounded-md border bg-background px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-slate-300">
            {STATUTS_HUMAINS.map((s) => <option key={s} value={s}>{STATUT_LABEL[s]}</option>)}
          </select>
          {d.confiance === 'à confirmer' && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">à confirmer</span>}
          <button type="button" disabled={pending} title="Modifier" onClick={() => setEditing(true)} className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={pending} title="Supprimer" onClick={() => run(() => deleteDecisionAction(reportId, d.id))} className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </li>
  )
}

function AddDecision({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [titre, setTitre] = useState('')
  const [sujet, setSujet] = useState('')
  const [role, setRole] = useState('')
  const [impact, setImpact] = useState<DecisionImpact | ''>('')
  const [ech, setEch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    setError(null)
    startTransition(async () => {
      try {
        const r = await addDecisionAction(reportId, { titre, sujet, decisionnaireRole: role, impact, echeance: ech })
        if (r.ok) { setTitre(''); setSujet(''); setRole(''); setImpact(''); setEch(''); router.refresh() }
        else setError(r.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-2">
      <input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Décision prise (ex. « Validation du revêtement : produit X retenu »)"
        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      <div className="flex flex-wrap items-center gap-2">
        <input value={sujet} onChange={(e) => setSujet(e.target.value)} placeholder="Sujet (ex. « revêtement »)"
          className="min-w-[8rem] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <select value={role} onChange={(e) => setRole(e.target.value)} title="Décisionnaire"
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
          <option value="">Décisionnaire…</option>
          {ACTION_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={impact} onChange={(e) => setImpact(e.target.value as DecisionImpact | '')} title="Impact"
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
          <option value="">Impact…</option>
          {DECISION_IMPACTS.map((i) => <option key={i} value={i}>{IMPACT_LABEL[i]}</option>)}
        </select>
        <input value={ech} onChange={(e) => setEch(e.target.value)} type="date" title="Échéance d'application (optionnelle)"
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <button type="button" disabled={pending || !titre.trim()} onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Décision
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  )
}

export function PvDecisionsBlock({ reportId, decisions }: { reportId: string; decisions: SiteDecision[] }) {
  return (
    <section className="space-y-2">
      <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Gavel className="h-3.5 w-3.5" /> Décisions ({decisions.length})
      </h2>
      {decisions.length > 0 && (
        <ul className="space-y-1">{decisions.map((d) => <Row key={d.id} reportId={reportId} d={d} />)}</ul>
      )}
      <AddDecision reportId={reportId} />
    </section>
  )
}
