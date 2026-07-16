'use client'

// « Synthèse de la visite » — le RÉSULTAT en premier, plus le procédé.
//
// La visite est la vérité ; ceci en est une LECTURE, mise à jour quand la matière
// change. L'analyse (résumé + vigilance + actions vivantes + décisions + à savoir
// + références) s'affiche DIRECTEMENT, se lance seule à l'ouverture (lazy-once),
// est mise en cache et rejouée sans rappeler le LLM.
//
// Présentation portée de la maquette v3 validée (« document technique BTP ») :
// une feuille distincte, un bandeau d'état, des blocs à pastille colorée, des
// actions en cartes pilotables. La transcription brute reste accessible mais
// REPLIÉE : c'est un détail, jamais le résultat principal.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Sparkles, Loader2, RefreshCw, ChevronDown, AlertTriangle, ListTodo, Eye,
  AlignLeft, Info, Calendar, Users, Square, CheckSquare, X, Check, Camera, Mic, Video, FileText,
} from 'lucide-react'
import { getVisitDebriefFieldAction, setVisitActionStateAction } from '../debrief-actions'
import type { StoredDebriefAnalysis, SnapshotDelta, ActionState } from '@/lib/visits/debrief-analysis'

type Phase = 'loading' | 'generating' | 'ready' | 'error'

/** Ton visuel d'un bloc — pastille + titre, calqués sur la maquette. */
type Tone = 'summary' | 'warn' | 'action' | 'decision' | 'info' | 'ref'
const TONE: Record<Tone, { ico: string; title: string }> = {
  summary: { ico: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300', title: 'text-sky-700 dark:text-sky-300' },
  warn: { ico: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300', title: 'text-amber-700 dark:text-amber-300' },
  action: { ico: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300', title: 'text-violet-700 dark:text-violet-300' },
  decision: { ico: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300', title: 'text-emerald-700 dark:text-emerald-300' },
  info: { ico: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300', title: 'text-sky-700 dark:text-sky-300' },
  ref: { ico: 'bg-slate-100 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300', title: 'text-slate-600 dark:text-slate-300' },
}

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
  const [staleDelta, setStaleDelta] = useState<SnapshotDelta | null>(null)
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
    setStaleDelta(res.status === 'stale' ? res.delta : null)
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

  // Décision humaine sur une action : optimiste tout de suite, persistée en fond.
  // L'IA n'efface jamais — un « fait »/« écarté » survit aux mises à jour de synthèse.
  function setActState(key: string, next: ActionState) {
    setAnalysis((prev) => prev
      ? { ...prev, action_ledger: (prev.action_ledger ?? []).map((x) => (x.key === key ? { ...x, state: next } : x)) }
      : prev)
    void setVisitActionStateAction({ report_id: reportId, key, state: next })
  }

  // ── En cours (analyse ou attente d'une analyse concurrente) ──
  if (phase === 'loading' || phase === 'generating') {
    return (
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">MemorIA prépare la synthèse…</p>
            <p className="text-[12px] text-muted-foreground">
              MemorIA lit ce que vous avez capturé et en dégage l’essentiel.
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
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">La synthèse n’a pas pu être générée</p>
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

  // ── Résultat : la synthèse de la visite ──
  const a = analysis!
  const sn = a.source_snapshot
  const summaryLines = (a.summary ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  const openActions = (a.action_ledger ?? []).filter((x) => x.state !== 'dismissed')
  const hasSummary = summaryLines.length > 0
  const hasActions = openActions.length > 0
  const hasWatch = a.watchpoints.length > 0
  const hasDecisions = a.decisions.length > 0
  const hasSavoir = a.a_savoir.length > 0
  const hasEcheances = a.echeances.length > 0
  const hasIntervenants = a.intervenants.length > 0
  const hasRefs = hasIntervenants || hasEcheances
  const generatedLabel = safeDate(a.generated_at)

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Masthead : la feuille se présente comme un document, pas un encart IA. */}
      <div className="border-b-2 border-sky-600/70 px-4 pb-3 pt-3.5 dark:border-sky-500/50">
        <div className="flex items-center gap-2">
          <Sparkles className="h-[18px] w-[18px] shrink-0 text-sky-600" />
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">Synthèse de la visite</p>
        </div>
      </div>

      {/* État de la visite — factuel : ce qui a été traité, et quand.
          Pas de « score de confiance » (fausse précision). */}
      <div className="flex flex-wrap items-center gap-1.5 border-b bg-emerald-50/30 px-4 py-2.5 dark:bg-emerald-950/10">
        {sn?.photos ? <StatePill Icon={Camera}>{sn.photos} photo{sn.photos > 1 ? 's' : ''}</StatePill> : null}
        {sn?.vocals ? <StatePill Icon={Mic}>{sn.vocals} mémo{sn.vocals > 1 ? 's' : ''}</StatePill> : null}
        {sn?.videos ? <StatePill Icon={Video}>{sn.videos} vidéo{sn.videos > 1 ? 's' : ''}</StatePill> : null}
        {sn?.notes ? <StatePill Icon={FileText}>{sn.notes} note{sn.notes > 1 ? 's' : ''}</StatePill> : null}
        {!staleDelta && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="h-3.5 w-3.5" /> toutes les sources traitées
          </span>
        )}
      </div>

      {/* Enrichie depuis la dernière synthèse : l'utilisateur DÉCIDE de la mettre à jour. */}
      {staleDelta && deltaTotal(staleDelta) > 0 && (
        <div className="border-b border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
          <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">Cette visite a été enrichie depuis la dernière synthèse.</p>
          <p className="mt-0.5 text-[12px] text-amber-800/80 dark:text-amber-300/80">Nouveau : {deltaLabel(staleDelta)}. La synthèse ci-dessous ne les prend pas encore en compte.</p>
          <button
            type="button"
            onClick={() => void load(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white active:brightness-95"
          >
            <RefreshCw className="h-4 w-4" /> Prendre en compte les nouveaux éléments
          </button>
        </div>
      )}

      {/* Corps — blocs distincts, ordre imposé : résumé → vigilance → actions →
          décisions → à savoir → références. */}
      <div className="flex flex-col gap-4 px-4 py-4">

        {hasSummary && (
          <Block tone="summary" Icon={AlignLeft} title="Résumé de la visite">
            {summaryLines.length > 1 ? (
              <ul className="space-y-2">
                {summaryLines.map((line, i) => (
                  <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-foreground/90">
                    <span className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-sm bg-sky-600" />
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] leading-relaxed text-foreground/90">{summaryLines[0]}</p>
            )}
          </Block>
        )}

        {hasWatch && (
          <Block tone="warn" Icon={Eye} title="Points de vigilance" sub="à surveiller">
            <ul className="space-y-2">
              {a.watchpoints.map((w, i) => (
                <li
                  key={i}
                  className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/20"
                >
                  <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0 text-amber-600" />
                  <span className="min-w-0 text-[13px] leading-snug">
                    <span className="font-medium text-foreground/90">{w.label}</span>
                    {(w.impact || w.owner || w.due) && (
                      <span className="mt-0.5 block text-[12px] text-amber-800/80 dark:text-amber-300/80">
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

        {hasActions && (
          <Block tone="action" Icon={ListTodo} title="Actions à réaliser" sub={`${openActions.length} proposée${openActions.length > 1 ? 's' : ''}`}>
            <div className="space-y-2.5">
              {openActions.map((act) => {
                const done = act.state === 'done'
                const isNew = a.analysis_version > 1 && act.version_added === a.analysis_version
                return (
                  <div key={act.key} className="flex gap-2.5 rounded-xl border bg-background p-3">
                    <button
                      type="button"
                      onClick={() => setActState(act.key, done ? 'open' : 'done')}
                      aria-label={done ? 'Rouvrir cette action' : 'Marquer comme faite'}
                      className="mt-px shrink-0 text-violet-600"
                    >
                      {done ? <CheckSquare className="h-[18px] w-[18px]" /> : <Square className="h-[18px] w-[18px]" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isNew && <Badge>Nouveau</Badge>}
                        {act.priority && <PriorityChip p={act.priority} />}
                      </div>
                      <p className={`mt-1 text-[14px] font-medium leading-snug ${done ? 'text-muted-foreground line-through' : 'text-foreground/90'}`}>{act.title}</p>
                      {act.rationale && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{act.rationale}</p>}
                      {(act.owner || act.due) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {act.owner && <Chip k="Responsable" v={act.owner} />}
                          {act.due && <Chip k="Échéance" v={act.due} />}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setActState(act.key, 'dismissed')}
                      aria-label="Écarter cette proposition"
                      className="mt-px shrink-0 text-muted-foreground/50 hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          </Block>
        )}

        {hasDecisions && (
          <Block tone="decision" Icon={Check} title="Décisions prises">
            <ul className="space-y-2">
              {a.decisions.map((d, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-foreground/90">
                  <Check className="mt-px h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="min-w-0">{d}</span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {hasSavoir && (
          <Block tone="info" Icon={Info} title="À savoir" sub="à retenir pour les prochaines visites">
            <ul className="space-y-1.5">
              {a.a_savoir.map((it, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-snug text-muted-foreground">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                  <span className="min-w-0">{it}</span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {hasRefs && (
          <Block tone="ref" Icon={Users} title="Références" sub="intervenants & échéances">
            <div className="space-y-3.5">
              {hasIntervenants && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Intervenants
                  </p>
                  <ul className="space-y-1.5">
                    {a.intervenants.map((it, i) => (
                      <li key={i} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                        <span className="min-w-0">{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {hasEcheances && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" /> Échéances
                  </p>
                  <ul className="space-y-1.5">
                    {a.echeances.map((it, i) => (
                      <li key={i} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                        <span className="min-w-0">{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Block>
        )}

        <TranscriptFold transcriptions={transcriptions} />
      </div>

      {/* Pied : quand la synthèse a été mise à jour, et comment la rafraîchir (jamais auto). */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground">
        <span>{generatedLabel ? `Synthèse mise à jour le ${generatedLabel}` : 'Synthèse'}</span>
        {confirmRegen ? (
          <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            <span className="text-[11px]">La mise à jour ajoute les nouveaux éléments, sans toucher aux actions déjà validées.</span>
            <button type="button" onClick={regenerate} className="rounded-md bg-sky-600 px-2 py-1 font-medium text-white">Mettre à jour</button>
            <button type="button" onClick={() => setConfirmRegen(false)} className="rounded-md px-2 py-1 hover:bg-muted">Annuler</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmRegen(true)} className="inline-flex items-center gap-1 hover:text-foreground">
            <RefreshCw className="h-3.5 w-3.5" /> Mettre à jour la synthèse
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

function deltaTotal(d: SnapshotDelta): number { return d.photos + d.videos + d.vocals + d.notes }
function deltaLabel(d: SnapshotDelta): string {
  const p: string[] = []
  if (d.photos) p.push(`${d.photos} photo${d.photos > 1 ? 's' : ''}`)
  if (d.videos) p.push(`${d.videos} vidéo${d.videos > 1 ? 's' : ''}`)
  if (d.vocals) p.push(`${d.vocals} mémo${d.vocals > 1 ? 's' : ''}`)
  if (d.notes) p.push(`${d.notes} note${d.notes > 1 ? 's' : ''}`)
  return p.length ? p.join(' · ') : 'de nouveaux éléments'
}

function Block({ tone, Icon, title, sub, children }: {
  tone: Tone
  Icon: typeof Eye
  title: string
  sub?: string
  children: React.ReactNode
}) {
  const t = TONE[tone]
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${t.ico}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className={`text-[12px] font-bold uppercase tracking-wider ${t.title}`}>{title}</span>
        {sub && <span className="ml-auto text-[11px] font-medium text-muted-foreground">{sub}</span>}
      </div>
      {children}
    </section>
  )
}

function StatePill({ Icon, children }: { Icon: typeof Camera; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[12px] font-medium">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {children}
    </span>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">{children}</span>
}

function PriorityChip({ p }: { p: 'haute' | 'moyenne' | 'basse' }) {
  const meta = {
    haute: { label: 'Priorité haute', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
    moyenne: { label: 'Priorité moyenne', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300/90' },
    basse: { label: 'Préparation', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  }[p]
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}>{meta.label}</span>
}

function Chip({ k, v }: { k: string; v: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
      <span className="text-muted-foreground/60">{k}</span> <b className="font-semibold text-foreground/90">{v}</b>
    </span>
  )
}

function TranscriptFold({ transcriptions }: { transcriptions: string[] }) {
  if (transcriptions.length === 0) return null
  return (
    <details className="group rounded-xl border bg-muted/20 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        Voir les données d’origine
      </summary>
      <div className="mt-2 space-y-2">
        {transcriptions.map((t, i) => (
          <p key={i} className="whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground">{t}</p>
        ))}
      </div>
    </details>
  )
}
