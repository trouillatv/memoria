'use client'

// Remarques HUMAINES ajoutées au CR (Vincent priorité #3) : « La société X s'engage
// à transmettre le DOE avant vendredi. » — texte libre rattaché à une section. AJOUT
// (pas une correction de la mémoire structurée). Injecté dans le CR à la section choisie.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2, MessageSquarePlus } from 'lucide-react'
import { addHumanPointAction, removeHumanPointAction } from '../../pv-actions'
import type { HumanPoint, HumanPointSection } from '@/lib/db/report-human-points'

const SECTIONS: { value: HumanPointSection; label: string }[] = [
  { value: 'points_examines', label: 'Points examinés' },
  { value: 'avancement', label: 'Avancement' },
  { value: 'previsions', label: 'Prévisions' },
  { value: 'securite', label: 'Sécurité' },
  { value: 'ordre_du_jour', label: 'Ordre du jour' },
]
const LABEL: Record<HumanPointSection, string> = Object.fromEntries(SECTIONS.map((s) => [s.value, s.label])) as Record<HumanPointSection, string>

export function PvHumanPoints({ reportId, points }: { reportId: string; points: HumanPoint[] }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [section, setSection] = useState<HumanPointSection>('points_examines')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (res.ok) { onOk?.(); router.refresh() }
        else setError(res.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  return (
    <section className="space-y-2">
      <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <MessageSquarePlus className="h-3.5 w-3.5" /> Remarques ajoutées ({points.length})
      </h2>

      {points.length > 0 && (
        <ul className="space-y-1">
          {points.map((p) => (
            <li key={p.id} className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{LABEL[p.section]}</span>
              <span className="min-w-0 flex-1">{p.text}</span>
              <button type="button" disabled={pending} title="Retirer" onClick={() => run(() => removeHumanPointAction(reportId, p.id))}
                className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Ajouter une remarque (ex. « La société X s'engage à transmettre le DOE avant vendredi. »)"
          className="min-w-[16rem] flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <select
          value={section}
          onChange={(e) => setSection(e.target.value as HumanPointSection)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          {SECTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button type="button" disabled={pending || !text.trim()} onClick={() => run(() => addHumanPointAction(reportId, section, text), () => setText(''))}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </section>
  )
}
