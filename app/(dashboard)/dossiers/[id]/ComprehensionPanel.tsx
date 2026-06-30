'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, RefreshCw, Check, AlertTriangle, CircleSlash, XOctagon } from 'lucide-react'
import { toast } from 'sonner'
import { generateComprehensionAction, rateAffirmationAction } from './actions'
import type { ComprehensionRunView, AffirmationVerdict } from '@/lib/db/comprehension'

// Lecture de reprise (lensTakeover) : l'ordre raconte « ce qu'il faut comprendre ».
const CATEGORY_FR: Record<string, string> = {
  site: 'Le site', important: 'Points importants', a_verifier: 'À vérifier',
  risque: 'Risques', poste: 'Postes potentiels',
}
const CATEGORY_ORDER = ['site', 'important', 'a_verifier', 'risque', 'poste']

// Grille 4 classes (cf. jury des résonances) — le jugement humain qui fera la donnée.
const VERDICTS: Array<{ key: AffirmationVerdict; label: string; icon: typeof Check; cls: string; activeCls: string }> = [
  { key: 'juste', label: 'Juste', icon: Check, cls: 'text-emerald-700', activeCls: 'border-emerald-600 bg-emerald-600 text-white' },
  { key: 'vague', label: 'Trop vague', icon: AlertTriangle, cls: 'text-amber-700', activeCls: 'border-amber-500 bg-amber-500 text-white' },
  { key: 'parasite', label: 'Parasite', icon: CircleSlash, cls: 'text-slate-600', activeCls: 'border-slate-500 bg-slate-500 text-white' },
  { key: 'dangereux', label: 'Dangereux', icon: XOctagon, cls: 'text-red-700', activeCls: 'border-red-600 bg-red-600 text-white' },
]

export function ComprehensionPanel({ dossierId, run }: { dossierId: string; run: ComprehensionRunView | null }) {
  const router = useRouter()
  const [generating, startGen] = useTransition()
  // Verdicts optimistes par affirmation.
  const [verdicts, setVerdicts] = useState<Record<string, AffirmationVerdict | null>>(
    () => Object.fromEntries((run?.affirmations ?? []).map((a) => [a.id, a.verdict])),
  )

  function generate() {
    startGen(async () => {
      const r = await generateComprehensionAction(dossierId)
      if (r.ok) { toast.success(`Compréhension générée — ${r.count} affirmation(s) à juger.`); router.refresh() }
      else toast.error(r.error)
    })
  }

  function rate(affirmationId: string, verdict: AffirmationVerdict) {
    const current = verdicts[affirmationId] ?? null
    const next = current === verdict ? null : verdict // toggle
    setVerdicts((v) => ({ ...v, [affirmationId]: next }))
    rateAffirmationAction({ affirmationId, dossierId, verdict: next })
      .then((r) => { if (!r.ok) { toast.error(r.error); setVerdicts((v) => ({ ...v, [affirmationId]: current })) } })
      .catch(() => setVerdicts((v) => ({ ...v, [affirmationId]: current })))
  }

  const affirmations = run?.affirmations ?? []
  const rated = affirmations.filter((a) => verdicts[a.id]).length
  const ordered = [...affirmations].sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)) || (a.ordinal - b.ordinal),
  )

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 space-y-3 dark:border-violet-900/40 dark:bg-violet-950/20">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-300">
          <Sparkles className="h-4 w-4" /> Voilà ce que j&apos;ai compris
        </h2>
        {run ? (
          <button
            type="button" onClick={generate} disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 px-2.5 py-1.5 text-[12px] font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:text-violet-300"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Régénérer
          </button>
        ) : null}
      </div>

      <p className="text-xs text-violet-900/70 dark:text-violet-200/70">
        Synthèse générée par l’IA pour un conducteur qui reprendrait l’affaire demain.
        Jugez chaque affirmation — c’est ce qui fera évoluer l’IA. L’IA propose, vous jugez.
      </p>

      {!run ? (
        <button
          type="button" onClick={generate} disabled={generating}
          className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Générer la compréhension
        </button>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {rated}/{affirmations.length} jugée(s){run.model ? ` · ${run.model}` : ''}
          </p>
          <ul className="space-y-2">
            {ordered.map((a) => {
              const v = verdicts[a.id] ?? null
              return (
                <li key={a.id} className="rounded-xl border bg-background p-3 space-y-2">
                  <div className="space-y-1">
                    <span className="inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                      {CATEGORY_FR[a.category] ?? a.category}
                    </span>
                    <p className="text-sm leading-snug">{a.text}</p>
                    {a.provenance.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        D’après : {a.provenance.slice(0, 3).join(' · ')}{a.provenance.length > 3 ? ` (+${a.provenance.length - 3})` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {VERDICTS.map((vd) => {
                      const Icon = vd.icon
                      const active = v === vd.key
                      return (
                        <button
                          key={vd.key} type="button" onClick={() => rate(a.id, vd.key)}
                          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition active:scale-[0.97] ${
                            active ? vd.activeCls : `border-border bg-background ${vd.cls} hover:bg-muted`
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" /> {vd.label}
                        </button>
                      )
                    })}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="rounded-lg border border-dashed bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
            Test « écho juste » : si tout est <strong>juste</strong>, l’IA restitue fidèlement la prévisite.
            Les <strong>dangereux</strong> et <strong>parasites</strong> sont les signaux à corriger en priorité.
          </p>
        </>
      )}
    </section>
  )
}
