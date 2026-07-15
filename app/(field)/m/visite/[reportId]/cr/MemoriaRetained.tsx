'use client'

// « Ce que MemorIA a retenu » — le RÉSULTAT en premier, plus le procédé.
//
// Avant, Guillaume ouvrait le compte-rendu et tombait sur un résumé pâle (ou, au
// PDF, le verbatim « euh » compris) : il croyait que MemorIA faisait de la dictée.
// Ici, l'analyse du débrief (narratif + actions proposées + points de vigilance)
// s'affiche DIRECTEMENT. Elle se lance TOUTE SEULE à l'ouverture (lazy-once), le
// résultat est mis en cache et rejoué ensuite sans rappeler le LLM.
//
// La transcription brute reste accessible, mais REPLIÉE : c'est un détail, plus
// le résultat principal. Si l'analyse échoue, la transcription reste consultable —
// on ne bloque jamais l'accès à ce qui a été dit.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, RefreshCw, ChevronDown, AlertTriangle, ListTodo, Eye, ListChecks, Info } from 'lucide-react'
import { getVisitDebriefFieldAction } from '../debrief-actions'
import type { StoredDebriefAnalysis } from '@/lib/visits/debrief-analysis'

type Phase = 'loading' | 'generating' | 'ready' | 'error'

export function MemoriaRetained({
  reportId,
  transcriptions,
}: {
  reportId: string
  /** Transcriptions brutes (vocaux) — repliées derrière « Voir la transcription ». */
  transcriptions: string[]
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [analysis, setAnalysis] = useState<StoredDebriefAnalysis | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aliveRef = useRef(true)
  const loadRef = useRef<(force: boolean) => void>(() => {})

  const load = useCallback(async (force: boolean) => {
    setPhase('loading')
    const res = await getVisitDebriefFieldAction({ report_id: reportId, ...(force ? { force: true } : {}) })
    if (!aliveRef.current) return
    if (!res.ok) {
      setPhase('error')
      return
    }
    if (res.status === 'generating') {
      // Un autre appel analyse déjà : on patiente puis on relit (pas de 2ᵉ LLM).
      setPhase('generating')
      pollRef.current = setTimeout(() => { if (aliveRef.current) loadRef.current(false) }, 4000)
      return
    }
    setAnalysis(res.loaded.analysis)
    setPhase('ready')
  }, [reportId])

  useEffect(() => { loadRef.current = load }, [load])

  useEffect(() => {
    aliveRef.current = true
    void load(false)
    return () => {
      aliveRef.current = false
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [load])

  function regenerate() {
    setConfirmRegen(false)
    void load(true)
  }

  // ── En cours (analyse ou attente d'une analyse concurrente) ──
  if (phase === 'loading' || phase === 'generating') {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">MemorIA analyse…</p>
            <p className="text-[12px] text-emerald-800/80 dark:text-emerald-300/80">
              MemorIA lit ce que vous avez capturé et prépare l’essentiel.
            </p>
          </div>
        </div>
      </section>
    )
  }

  // ── Échec : la transcription reste accessible, on ne bloque jamais ──
  if (phase === 'error') {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">L’analyse n’a pas pu être générée</p>
            <p className="text-[12px] text-amber-800/80 dark:text-amber-300/80">
              La transcription, elle, est conservée — vous pouvez la lire ci-dessous.
            </p>
            <button
              type="button"
              onClick={() => void load(true)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-background px-3 py-1.5 text-sm font-medium active:bg-accent"
            >
              <RefreshCw className="h-4 w-4" /> Réessayer
            </button>
          </div>
        </div>
        <TranscriptFold transcriptions={transcriptions} />
      </section>
    )
  }

  // ── Résultat : « Ce que MemorIA a retenu » ──
  const a = analysis!
  const hasActions = a.actions.length > 0
  const hasWatch = a.watchpoints.length > 0
  const hasDecisions = a.decisions.length > 0
  const hasSavoir = a.a_savoir.length > 0
  const generatedLabel = safeDate(a.generated_at)

  return (
    <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <div className="flex items-center gap-2">
        <Sparkles className="h-[18px] w-[18px] shrink-0 text-emerald-600" />
        <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Ce que MemorIA a retenu</h2>
      </div>

      {a.summary.trim() && (
        <Block Icon={ListChecks} cls="text-emerald-600" title="Résumé">
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">{a.summary.trim()}</p>
        </Block>
      )}

      {hasDecisions && (
        <Block Icon={ListChecks} cls="text-indigo-600" title="Décisions">
          <BulletList items={a.decisions} dot="bg-indigo-500" />
        </Block>
      )}

      {hasActions && (
        <Block Icon={ListTodo} cls="text-violet-600" title="Actions proposées">
          <ul className="space-y-2">
            {a.actions.map((act, i) => (
              <li key={i} className="text-[13px] leading-snug">
                <span className="flex flex-wrap items-center gap-1.5">
                  {act.priority && <PriorityChip p={act.priority} />}
                  <span className="font-medium text-foreground/90">{act.title}</span>
                </span>
                {act.rationale && <span className="mt-0.5 block text-[12px] text-muted-foreground">{act.rationale}</span>}
                {(act.owner || act.due) && (
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {act.owner && `Responsable : ${act.owner}`}{act.owner && act.due ? ' · ' : ''}{act.due && `Échéance : ${act.due}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {hasWatch && (
        <Block Icon={Eye} cls="text-amber-600" title="Points de vigilance">
          <ul className="space-y-2">
            {a.watchpoints.map((w, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug">
                <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="min-w-0">
                  <span className="font-medium text-foreground/90">{w.label}</span>
                  {(w.impact || w.owner || w.due) && (
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {w.impact}
                      {w.owner ? `${w.impact ? ' · ' : ''}Responsable : ${w.owner}` : ''}
                      {w.due ? `${w.impact || w.owner ? ' · ' : ''}Échéance : ${w.due}` : ''}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {hasSavoir && (
        <Block Icon={Info} cls="text-sky-600" title="À savoir">
          <BulletList items={a.a_savoir} dot="bg-sky-500" />
        </Block>
      )}

      <TranscriptFold transcriptions={transcriptions} />

      {/* Discret : quand l'analyse a été faite, et la régénérer (jamais auto). */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-200/60 pt-2 text-[11px] text-muted-foreground dark:border-emerald-900/40">
        <span>{generatedLabel ? `Analyse générée le ${generatedLabel}` : 'Analyse générée'}</span>
        {confirmRegen ? (
          <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            <span className="text-[11px]">Régénérer remplace les propositions, sans toucher aux actions validées.</span>
            <button type="button" onClick={regenerate} className="rounded-md bg-emerald-600 px-2 py-1 font-medium text-white">Régénérer</button>
            <button type="button" onClick={() => setConfirmRegen(false)} className="rounded-md px-2 py-1 hover:bg-muted">Annuler</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmRegen(true)} className="inline-flex items-center gap-1 hover:text-foreground">
            <RefreshCw className="h-3.5 w-3.5" /> Régénérer
          </button>
        )}
      </div>
    </section>
  )
}

function safeDate(iso: string): string | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

function Block({ Icon, cls, title, children }: { Icon: typeof Eye; cls: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${cls}`} /> {title}
      </div>
      {children}
    </div>
  )
}

function PriorityChip({ p }: { p: 'haute' | 'moyenne' | 'basse' }) {
  const meta = {
    haute: { label: 'Haute', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
    moyenne: { label: 'Moyenne', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
    basse: { label: 'Préparation', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  }[p]
  return <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}>{meta.label}</span>
}

function BulletList({ items, dot }: { items: string[]; dot: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
          <span className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${dot}`} />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  )
}

function TranscriptFold({ transcriptions }: { transcriptions: string[] }) {
  if (transcriptions.length === 0) return null
  return (
    <details className="rounded-xl border bg-muted/20 px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
        <ChevronDown className="h-4 w-4 transition-transform [details[open]_&]:rotate-180" />
        Voir la transcription
      </summary>
      <div className="mt-2 space-y-2">
        {transcriptions.map((t, i) => (
          <p key={i} className="whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground">{t}</p>
        ))}
      </div>
    </details>
  )
}
