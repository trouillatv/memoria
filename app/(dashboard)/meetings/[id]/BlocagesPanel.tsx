'use client'

// Blocages de chantier sur la page Réunion (mig 160). Trois zones :
//  1. Détection PV : les dépendances/risques extraits par l'IA proposés comme
//     blocages — l'IA PROPOSE, l'humain VALIDE (jamais créés tout seuls).
//  2. Blocages déjà enregistrés depuis ce CR.
//  3. Ajout manuel.
// Doctrine : descriptif, jamais un score ni une imputation de retard.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Construction, Check, X, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  addBlocageFromReportAction,
  deleteBlocageAction,
} from '../../blocage-actions'
import {
  BLOCAGE_TYPES,
  BLOCAGE_TYPE_LABEL,
  type BlocageType,
} from '@/lib/db/blocage-constants'

export interface BlocageSuggestion {
  label: string
  rationale: string | null
  type: BlocageType
}

export interface ExistingBlocage {
  id: string
  type: BlocageType
  title: string
  impact: string | null
  dateStart: string
  dateEnd: string | null
}

interface Props {
  reportId: string
  siteId: string | null
  suggestions: BlocageSuggestion[]
  blocages: ExistingBlocage[]
}

function norm(s: string): string {
  return s.trim().toLowerCase()
}

function TypeSelect({ value, onChange }: { value: BlocageType; onChange: (v: BlocageType) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BlocageType)}
      title="Type de blocage"
      className="rounded border px-2 py-1 text-xs"
    >
      {BLOCAGE_TYPES.map((t) => (
        <option key={t} value={t}>{BLOCAGE_TYPE_LABEL[t]}</option>
      ))}
    </select>
  )
}

function SuggestionRow({ reportId, suggestion }: { reportId: string; suggestion: BlocageSuggestion }) {
  const router = useRouter()
  const [type, setType] = useState<BlocageType>(suggestion.type)
  const [title, setTitle] = useState(suggestion.label)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (done) return null

  function create() {
    setError(null)
    start(async () => {
      const res = await addBlocageFromReportAction(reportId, {
        type,
        title: title.trim(),
        impact: suggestion.rationale,
        sourceType: 'detected',
      })
      if (res.ok) { setDone(true); router.refresh() }
      else setError(res.error ?? 'Échec')
    })
  }

  return (
    <li className="rounded-lg border border-dashed border-rose-200 bg-rose-50/40 p-3 space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded border bg-background px-2 py-1 text-sm font-medium"
      />
      {suggestion.rationale && (
        <p className="text-xs text-muted-foreground">{suggestion.rationale}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <TypeSelect value={type} onChange={setType} />
        {error && <span className="text-xs text-rose-700">{error}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={create}
            disabled={pending || !title.trim()}
            className="inline-flex items-center gap-1 rounded bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Créer le blocage
          </button>
          <button
            type="button"
            onClick={() => setDone(true)}
            className="inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs hover:bg-muted/40"
          >
            <X className="h-3 w-3" /> Ignorer
          </button>
        </div>
      </div>
    </li>
  )
}

function ExistingRow({ siteId, blocage }: { siteId: string | null; blocage: ExistingBlocage }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const ongoing = blocage.dateEnd === null

  function remove() {
    if (!siteId) return
    start(async () => {
      const res = await deleteBlocageAction(siteId, blocage.id)
      if (res.ok) router.refresh()
    })
  }

  return (
    <li className="flex items-start justify-between gap-2 rounded-lg border bg-card p-3 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-900">
            {BLOCAGE_TYPE_LABEL[blocage.type]}
          </span>
          <span className="font-medium">{blocage.title}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {blocage.dateStart}
          {blocage.dateEnd && blocage.dateEnd !== blocage.dateStart ? ` → ${blocage.dateEnd}` : ''}
          {ongoing ? ' · en cours' : ' · levé'}
          {blocage.impact ? ` · ${blocage.impact}` : ''}
        </div>
      </div>
      {siteId && (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          title="Supprimer"
          className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      )}
    </li>
  )
}

function AddBlocage({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<BlocageType>('autre')
  const [title, setTitle] = useState('')
  const [impact, setImpact] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    start(async () => {
      const res = await addBlocageFromReportAction(reportId, {
        type,
        title: title.trim(),
        impact: impact.trim() || null,
        sourceType: 'meeting',
      })
      if (res.ok) {
        setTitle(''); setImpact(''); setType('autre'); setOpen(false); router.refresh()
      } else setError(res.error ?? 'Échec')
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium hover:bg-muted/40"
      >
        <Plus className="h-3 w-3" /> Ajouter un blocage
      </button>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Ce qui a empêché d'avancer"
        className="w-full rounded border px-2 py-1 text-sm font-medium"
      />
      <input
        value={impact}
        onChange={(e) => setImpact(e.target.value)}
        placeholder="Impact (facultatif) — ex. terrassement reporté"
        className="w-full rounded border px-2 py-1 text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <TypeSelect value={type} onChange={setType} />
        {error && <span className="text-xs text-rose-700">{error}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !title.trim()}
            className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Enregistrer
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded border px-2.5 py-1 text-xs hover:bg-muted/40">Annuler</button>
        </div>
      </div>
    </div>
  )
}

export function BlocagesPanel({ reportId, siteId, suggestions, blocages }: Props) {
  // Une suggestion déjà matérialisée (même titre normalisé) ne se re-propose pas.
  const existingTitles = new Set(blocages.map((b) => norm(b.title)))
  const freshSuggestions = suggestions.filter((s) => !existingTitles.has(norm(s.label)))

  // Rien à montrer : pas de section (anti-bruit).
  if (freshSuggestions.length === 0 && blocages.length === 0) {
    return (
      <section className="rounded-xl border bg-card p-4 space-y-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Construction className="h-4 w-4 text-rose-600" /> Blocages chantier
        </h2>
        <p className="text-sm text-muted-foreground italic">Aucun blocage signalé.</p>
        <AddBlocage reportId={reportId} />
      </section>
    )
  }

  return (
    <section className="rounded-xl border bg-card p-4 space-y-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
        <Construction className="h-4 w-4 text-rose-600" /> Blocages chantier
      </h2>

      {freshSuggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Détectés dans la réunion ({freshSuggestions.length}) — créer un blocage ?
          </p>
          <ul className="space-y-2">
            {freshSuggestions.map((s, i) => (
              <SuggestionRow key={`${norm(s.label)}-${i}`} reportId={reportId} suggestion={s} />
            ))}
          </ul>
        </div>
      )}

      {blocages.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Blocages enregistrés ({blocages.length})
          </p>
          <ul className="space-y-2">
            {blocages.map((b) => (
              <ExistingRow key={b.id} siteId={siteId} blocage={b} />
            ))}
          </ul>
        </div>
      )}

      <AddBlocage reportId={reportId} />
    </section>
  )
}
