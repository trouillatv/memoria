'use client'

// Déclaration d'un blocage depuis la page Site (mig 160). Compact : un bouton
// qui ouvre un petit formulaire. Le blocage apparaît ensuite dans la Mémoire
// du lieu (timeline). Doctrine : descriptif, daté ; pas de planning, pas de score.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Construction, Check, Loader2 } from 'lucide-react'
import { declareSiteBlocageAction } from '../../blocage-actions'
import { BLOCAGE_TYPES, BLOCAGE_TYPE_LABEL, type BlocageType } from '@/lib/db/blocage-constants'

export function DeclareBlocage({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<BlocageType>('intemperie')
  const [title, setTitle] = useState('')
  const [impact, setImpact] = useState('')
  const [dateStart, setDateStart] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    start(async () => {
      const res = await declareSiteBlocageAction(siteId, {
        type,
        title: title.trim(),
        impact: impact.trim() || null,
        dateStart: dateStart || null,
      })
      if (res.ok) {
        setTitle(''); setImpact(''); setDateStart(''); setType('intemperie'); setOpen(false)
        router.refresh()
      } else setError(res.error ?? 'Échec')
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
      >
        <Construction className="h-3.5 w-3.5" /> Déclarer un blocage
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
        placeholder="Impact (facultatif) — ex. dalle non coulée"
        className="w-full rounded border px-2 py-1 text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as BlocageType)}
          title="Type de blocage"
          className="rounded border px-2 py-1 text-xs"
        >
          {BLOCAGE_TYPES.map((t) => (
            <option key={t} value={t}>{BLOCAGE_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          Date
          <input
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="rounded border px-2 py-1 text-xs"
          />
        </label>
        {error && <span className="text-xs text-rose-700">{error}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !title.trim()}
            className="inline-flex items-center gap-1 rounded bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Enregistrer
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded border px-2.5 py-1 text-xs hover:bg-muted/40">Annuler</button>
        </div>
      </div>
    </div>
  )
}
