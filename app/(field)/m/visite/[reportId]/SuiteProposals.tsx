'use client'

// « Suites à créer » — au débrief, les captures taguées ✅ Action / ⚠️ Réserve
// deviennent de vrais objets AU NIVEAU CHANTIER. MemorIA PROPOSE ; l'humain
// valide (Créer), modifie (le titre est éditable) ou ignore. RIEN n'est créé
// sans validation. Si un objet similaire existe déjà : « Rattacher » plutôt que
// dupliquer. Cf. règle : terrain = capturer ; débrief = transformer ; chantier =
// porter la vérité.

import { useState, useTransition } from 'react'
import { AlertTriangle, Check, ListTodo, X } from 'lucide-react'
import { toast } from 'sonner'
import { createSuiteAction, resolveSuiteAction } from './debrief-actions'
import type { VisitSuiteProposal } from '@/lib/db/visits'

export function SuiteProposals({ initialSuites }: { initialSuites: VisitSuiteProposal[] }) {
  const [suites, setSuites] = useState(initialSuites)
  const [titles, setTitles] = useState<Record<string, string>>(
    () => Object.fromEntries(initialSuites.map((s) => [s.captureId, s.text])),
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, start] = useTransition()
  if (suites.length === 0) return null

  const remove = (captureId: string) => setSuites((s) => s.filter((x) => x.captureId !== captureId))

  function create(s: VisitSuiteProposal) {
    const title = (titles[s.captureId] ?? s.text).trim()
    if (!title) return
    setBusyId(s.captureId)
    start(async () => {
      const r = await createSuiteAction({ capture_id: s.captureId, kind: s.kind, title })
      setBusyId(null)
      if (r.ok) { toast.success(s.kind === 'reserve' ? 'Réserve créée' : 'Action créée', { duration: 1200 }); remove(s.captureId) }
      else toast.error(r.error)
    })
  }

  function resolve(s: VisitSuiteProposal, resolution: 'ignored' | 'attached') {
    setBusyId(s.captureId)
    start(async () => {
      const r = await resolveSuiteAction({ capture_id: s.captureId, resolution })
      setBusyId(null)
      if (r.ok) remove(s.captureId)
      else toast.error(r.error)
    })
  }

  return (
    <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900/40 dark:bg-amber-950/15">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Suites à créer ({suites.length})</h2>
        <p className="text-[12px] text-amber-800/80 dark:text-amber-200/70">MemorIA propose — vous validez. Rien n&apos;est créé sans vous.</p>
      </div>
      <ul className="space-y-2">
        {suites.map((s) => {
          const isReserve = s.kind === 'reserve'
          const busy = busyId === s.captureId
          return (
            <li key={s.captureId} className={`space-y-2 rounded-lg border bg-background p-2.5 ${busy ? 'opacity-60' : ''}`}>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${isReserve ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                {isReserve ? <AlertTriangle className="h-3 w-3" /> : <ListTodo className="h-3 w-3" />} {isReserve ? 'Réserve' : 'Action'}
              </span>
              <input
                value={titles[s.captureId] ?? s.text}
                onChange={(e) => setTitles((t) => ({ ...t, [s.captureId]: e.target.value }))}
                className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                maxLength={300}
              />
              {s.similar.length > 0 && (
                <div className="rounded-lg bg-amber-100/60 px-2.5 py-1.5 text-[11px] text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                  Similaire déjà ouverte : « {s.similar[0].label} ».{' '}
                  <button type="button" onClick={() => resolve(s, 'attached')} disabled={busy} className="font-medium underline">
                    Rattacher (ne pas dupliquer)
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button" onClick={() => create(s)} disabled={busy}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" /> Créer
                </button>
                <button
                  type="button" onClick={() => resolve(s, 'ignored')} disabled={busy}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium text-muted-foreground disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Ignorer
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
