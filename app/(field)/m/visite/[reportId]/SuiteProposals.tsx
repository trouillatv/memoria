'use client'

// « MemorIA a compris votre visite » — l'écran où MemorIA PROPOSE des suites et où
// le conducteur DÉCIDE. Deux origines, un seul écran :
//   • tags terrain (photo/vidéo taguée ✅ Action / ⚠️ Réserve au tri) ;
//   • ce que MemorIA a COMPRIS des vocaux/notes (IA, texte seul, gatée).
// Trois familles : Actions · Réserves · À surveiller. Pour chacune : Créer /
// Modifier (le titre est éditable) / Ignorer. RIEN n'est créé sans validation.
// Si un objet proche existe déjà : « Rattacher » plutôt que dupliquer. Cf. règle :
// terrain = capturer ; débrief = comprendre ; chantier = porter la vérité.

import { useState, useTransition } from 'react'
import { AlertTriangle, Check, ListTodo, Eye, X, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { createSuiteAction, resolveSuiteAction } from './debrief-actions'
import type { VisitSuiteProposal } from '@/lib/db/visits'

type Kind = VisitSuiteProposal['kind']

const KIND_META: Record<Kind, { label: string; verb: string; Icon: typeof ListTodo; chip: string }> = {
  action: { label: 'Action à réaliser', verb: 'Créer', Icon: ListTodo, chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  // Le meme mot qu au triage, au mot pres : « réserve à lever », jamais
  // « réserve » seul — sinon on rouvre l ambiguite « mise de cote ».
  reserve: { label: 'Réserve à lever', verb: 'Créer', Icon: AlertTriangle, chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
  surveiller: { label: 'À surveiller', verb: 'Suivre', Icon: Eye, chip: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
}
const ORDER: Kind[] = ['action', 'reserve', 'surveiller']

export function SuiteProposals({ initialSuites }: { initialSuites: VisitSuiteProposal[] }) {
  const [suites, setSuites] = useState(initialSuites)
  const [titles, setTitles] = useState<Record<string, string>>(
    () => Object.fromEntries(initialSuites.map((s) => [s.id, s.text])),
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, start] = useTransition()
  if (suites.length === 0) return null

  const remove = (id: string) => setSuites((s) => s.filter((x) => x.id !== id))

  function create(s: VisitSuiteProposal) {
    const title = (titles[s.id] ?? s.text).trim()
    if (!title) return
    setBusyId(s.id)
    start(async () => {
      const r = await createSuiteAction({ capture_id: s.captureId, kind: s.kind, title, proposal_id: s.proposalId })
      setBusyId(null)
      if (r.ok) { toast.success(`${KIND_META[s.kind].label} enregistrée`, { duration: 1200 }); remove(s.id) }
      else toast.error(r.error)
    })
  }

  function resolve(s: VisitSuiteProposal, resolution: 'ignored' | 'attached') {
    setBusyId(s.id)
    start(async () => {
      const r = await resolveSuiteAction({ capture_id: s.captureId, resolution, proposal_id: s.proposalId })
      setBusyId(null)
      if (r.ok) remove(s.id)
      else toast.error(r.error)
    })
  }

  // Récap façon « MemorIA a compris » : n actions · n réserves · n à surveiller.
  const counts = ORDER.map((k) => ({ k, n: suites.filter((s) => s.kind === k).length })).filter((c) => c.n > 0)
  const summary = counts
    .map((c) => `${c.n} ${c.k === 'action' ? (c.n > 1 ? 'actions' : 'action') : c.k === 'reserve' ? (c.n > 1 ? 'réserves' : 'réserve') : 'à surveiller'}`)
    .join(' · ')

  return (
    <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/15">
      <div className="space-y-0.5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          <Sparkles className="h-4 w-4" /> MemorIA a compris votre visite
        </h2>
        <p className="text-[12px] text-emerald-800/80 dark:text-emerald-200/70">{summary} — vous validez. Rien n&apos;est créé sans vous.</p>
      </div>

      {ORDER.map((k) => {
        const group = suites.filter((s) => s.kind === k)
        if (group.length === 0) return null
        const meta = KIND_META[k]
        return (
          <div key={k} className="space-y-2">
            {group.map((s) => {
              const busy = busyId === s.id
              // On ne crée jamais une suite sans nom (fini les « Action à préciser »).
              const canCreate = (titles[s.id] ?? s.text).trim().length > 0
              return (
                <div key={s.id} className={`space-y-2 rounded-lg border bg-background p-2.5 ${busy ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}>
                      <meta.Icon className="h-3 w-3" /> {meta.label}
                    </span>
                    {s.source === 'ai' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700/80 dark:text-emerald-300/70">
                        <Sparkles className="h-3 w-3" /> proposé par MemorIA
                      </span>
                    )}
                  </div>

                  {s.source === 'ai' && s.excerpt && (
                    <p className="rounded bg-muted/60 px-2 py-1 text-[11px] italic text-muted-foreground">depuis « {s.excerpt} »</p>
                  )}

                  {/* Suite née d'un tag SANS commentaire : on dit d'où elle vient
                      (le geste du conducteur), pas une tâche vide surgie de nulle part. */}
                  {s.source === 'tag' && !s.text.trim() && (
                    <p className="text-[11px] text-muted-foreground">
                      Depuis une photo que vous avez taguée « {k === 'reserve' ? 'réserve à lever' : 'à faire'} » — nommez-la ou ignorez-la.
                    </p>
                  )}

                  <input
                    value={titles[s.id] ?? s.text}
                    onChange={(e) => setTitles((t) => ({ ...t, [s.id]: e.target.value }))}
                    placeholder={k === 'reserve' ? 'Décrivez la réserve…' : k === 'surveiller' ? 'Que faut-il surveiller ?' : 'Nommez l’action à réaliser…'}
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
                      type="button" onClick={() => create(s)} disabled={busy || !canCreate}
                      className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> {meta.verb}
                    </button>
                    <button
                      type="button" onClick={() => resolve(s, 'ignored')} disabled={busy}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium text-muted-foreground disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" /> Ignorer
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </section>
  )
}
