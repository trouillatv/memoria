'use client'

// Copilote Phase 3 — conversation libre + propositions (3C).
// Les 4 questions rapides restent comme raccourcis.
// L'historique est maintenu localement (3 échanges max, stateless côté serveur).
// Les liens suggested ne sont jamais envoyés au LLM (filtrage côté serveur).

import { useState, useRef, useEffect, type FormEvent } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, ExternalLink, SendHorizontal, X, ChevronDown, ChevronUp } from 'lucide-react'
import {
  askCopilotFreeAction,
  type CopilotFreeResult,
  type CopilotFreeCandidate,
} from '../../copilot-free-action'
import { askCopilotAction, type CopilotActionResult } from '../../copilot-action'
import { trackCopilotReferenceClick } from '../../copilot-event-action'
import { fetchPlanItems, removePlanItem, type PlanItemSummary } from '../../copilot-plan-actions'
import type { CopilotIntent } from '@/lib/visits/copilot-context'
import type { CopilotProposal } from '@/lib/visits/copilot-proposal'
import { ProposalCard, ScheduleProposalCard } from '@/components/copilot/CopilotProposalCards'
import { CapabilityDiscoveryPanel } from '@/components/copilot/CapabilityDiscoveryPanel'
import { cn } from '@/lib/utils'

// ── Types locaux ──────────────────────────────────────────────────────────────

type Msg =
  | { kind: 'user';          id: string; text: string }
  | { kind: 'answer';        id: string; text: string; source: 'llm' | 'fallback'; refs: { id: string; label: string; href: string | null }[]; interactionId: string | null }
  | { kind: 'clarification'; id: string; text: string; candidates: CopilotFreeCandidate[]; interactionId: string | null }
  | { kind: 'proposal';      id: string; text: string; proposal: CopilotProposal; interactionId: string | null }
  | { kind: 'thinking';      id: string }

const QUICK_QUESTIONS: { intent: CopilotIntent; label: string }[] = [
  { intent: 'attention',  label: "Qu'est-ce qui mérite mon attention ?" },
  { intent: 'changes',    label: "Qu'est-ce qui a changé récemment ?" },
  { intent: 'stale',      label: "Qu'est-ce qui traîne ?" },
  { intent: 'next_visit', label: "Que dois-je vérifier à ma prochaine visite ?" },
]


function uid() {
  return Math.random().toString(36).slice(2, 9)
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function CopilotBlock({ siteId }: { siteId: string }) {
  const [messages, setMessages]               = useState<Msg[]>([])
  const [inputText, setInputText]             = useState('')
  const [loading, setLoading]                 = useState(false)
  // Sujets déjà résolus dans la session (court-circuit la résolution pour les suivis)
  const [resolvedSubjectIds, setResolvedIds]  = useState<string[]>([])
  // UUID stable de session — regroupe les échanges d'une conversation côté télémétrie
  const [conversationId]                      = useState<string>(() => crypto.randomUUID())
  // Question originale qui a déclenché la dernière clarification — préservée pour le replay
  const pendingQuestionRef                    = useRef<string | null>(null)
  // Plan de prochaine visite — chargé au montage, rafraîchi après ajout
  const [planItems, setPlanItems]             = useState<PlanItemSummary[]>([])
  // Panneau de découverte étendu
  const [expanded, setExpanded]               = useState(false)
  const bottomRef                             = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchPlanItems(siteId).then(setPlanItems).catch(() => {})
  }, [siteId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Historique des 3 derniers échanges (utilisateur + assistant) pour le contexte LLM
  function buildHistory(): { role: 'user' | 'assistant'; content: string }[] {
    const result: { role: 'user' | 'assistant'; content: string }[] = []
    for (const m of messages.filter((m) => m.kind === 'user' || m.kind === 'answer').slice(-6)) {
      if (m.kind === 'user')   result.push({ role: 'user', content: m.text })
      if (m.kind === 'answer') result.push({ role: 'assistant', content: m.text })
    }
    return result
  }

  async function send(question: string, extraResolvedIds?: string[], selectedCandidateId?: string) {
    if (loading || !question.trim()) return
    setLoading(true)

    const userMsg: Msg = { kind: 'user', id: uid(), text: question }
    const thinkingMsg: Msg = { kind: 'thinking', id: uid() }
    setMessages((prev) => [...prev, userMsg, thinkingMsg])
    setInputText('')

    const allResolvedIds = [
      ...resolvedSubjectIds,
      ...(extraResolvedIds ?? []),
    ]

    try {
      const result: CopilotFreeResult = await askCopilotFreeAction({
        siteId,
        question,
        history: buildHistory(),
        resolvedSubjectIds: allResolvedIds,
        conversationId,
        ...(selectedCandidateId ? { selectedCandidateId } : {}),
      })

      // Mémoriser la question originale si une clarification est demandée
      // pour la rejouer intacte quand l'utilisateur sélectionne un candidat.
      if (result.kind === 'clarification') {
        pendingQuestionRef.current = question
      }

      setMessages((prev) => {
        const withoutThinking = prev.filter((m) => m.kind !== 'thinking')
        if (result.kind === 'answer') {
          return [...withoutThinking, {
            kind: 'answer',
            id: uid(),
            text: result.text,
            source: result.source,
            refs: result.references,
            interactionId: result.interactionId,
          }]
        }
        if (result.kind === 'clarification') {
          return [...withoutThinking, {
            kind: 'clarification',
            id: uid(),
            text: result.text,
            candidates: result.candidates,
            interactionId: result.interactionId,
          }]
        }
        if (result.kind === 'proposal') {
          return [...withoutThinking, {
            kind: 'proposal',
            id: uid(),
            text: result.text,
            proposal: result.proposal,
            interactionId: result.interactionId,
          }]
        }
        // write_not_supported (fallback legacy)
        return [...withoutThinking, {
          kind: 'answer',
          id: uid(),
          text: result.text,
          source: 'fallback',
          refs: [],
          interactionId: null,
        }]
      })
    } catch {
      setMessages((prev) => {
        const withoutThinking = prev.filter((m) => m.kind !== 'thinking')
        return [...withoutThinking, {
          kind: 'answer', id: uid(),
          text: 'Une erreur est survenue. Réessayez dans quelques instants.',
          source: 'fallback', refs: [], interactionId: null,
        }]
      })
    } finally {
      setLoading(false)
    }
  }

  // Raccourcis Phase 2 — passent par le même chemin Phase 3 pour maintenir l'historique
  async function sendQuick(intent: CopilotIntent, label: string) {
    if (loading) return
    setLoading(true)

    const userMsg: Msg = { kind: 'user', id: uid(), text: label }
    const thinkingMsg: Msg = { kind: 'thinking', id: uid() }
    setMessages((prev) => [...prev, userMsg, thinkingMsg])

    try {
      const result: CopilotActionResult = await askCopilotAction({ siteId, intent, conversationId })
      setMessages((prev) => {
        const withoutThinking = prev.filter((m) => m.kind !== 'thinking')
        return [...withoutThinking, {
          kind: 'answer', id: uid(),
          text: result.text, source: result.source,
          refs: result.references,
          interactionId: result.interactionId,
        }]
      })
    } catch {
      setMessages((prev) => prev.filter((m) => m.kind !== 'thinking'))
    } finally {
      setLoading(false)
    }
  }

  // Sélection d'un candidat après clarification — rejoue la question originale avec le sujet résolu.
  // La question originale est préservée dans pendingQuestionRef pour éviter le fallback « Parle-moi de X ».
  function selectCandidate(candidate: CopilotFreeCandidate) {
    const originalQuestion = pendingQuestionRef.current ?? `Parle-moi de ${candidate.label}`
    pendingQuestionRef.current = null
    setResolvedIds((prev) => [...prev, candidate.id])
    send(originalQuestion, [candidate.id], candidate.id)
  }

  async function removeItem(id: string) {
    const res = await removePlanItem(id, siteId)
    if (res.ok) setPlanItems((prev) => prev.filter((i) => i.id !== id))
  }

  function clear() {
    setMessages([])
    setResolvedIds([])
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(inputText)
  }

  const hasMessages = messages.length > 0

  return (
    <section className="rounded-[18px] border border-dashed border-foreground/15 bg-card p-4 shadow-sm">
      {/* En-tête */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
          <h2 className="text-sm font-semibold text-foreground/80">Demander à MemorIA</h2>
        </div>
        {hasMessages && (
          <button
            type="button"
            onClick={clear}
            className="text-[12px] text-muted-foreground hover:text-foreground"
          >
            Nouvelle conversation
          </button>
        )}
      </div>

      {/* Raccourcis + panneau de découverte — visibles uniquement si pas encore de conversation */}
      {!hasMessages && (
        <div className="mb-3 space-y-2">
          {/* Suggestions compactes */}
          <div className="flex flex-wrap gap-2">
            {QUICK_QUESTIONS.map(({ intent, label }) => (
              <button
                key={intent}
                type="button"
                onClick={() => { setExpanded(false); sendQuick(intent, label) }}
                disabled={loading}
                className="rounded-full border border-border bg-background px-3 py-1.5 text-[13px] font-medium text-foreground/70 hover:bg-muted disabled:opacity-50 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Bouton découverte */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-800 px-3 py-1 text-[12px] font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950/40 transition-colors"
          >
            {expanded
              ? <><ChevronUp className="h-3.5 w-3.5" /> Fermer</>
              : <><ChevronDown className="h-3.5 w-3.5" /> Explorer ce que MemorIA sait faire</>
            }
          </button>

          {/* Catalogue progressif L1/L2 */}
          {expanded && (
            <CapabilityDiscoveryPanel
              onSelectQuestion={(q) => { setExpanded(false); send(q) }}
              disabled={loading}
            />
          )}
        </div>
      )}

      {/* Historique de conversation */}
      {hasMessages && (
        <div className="mb-3 space-y-3 max-h-[480px] overflow-y-auto">
          {messages.map((msg) => {
            if (msg.kind === 'thinking') {
              return (
                <div key={msg.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analyse…
                </div>
              )
            }

            if (msg.kind === 'user') {
              return (
                <div key={msg.id} className="flex justify-end">
                  <span className="max-w-[80%] rounded-2xl rounded-br-sm bg-violet-100 dark:bg-violet-950/40 px-3 py-2 text-[13px] text-violet-900 dark:text-violet-100">
                    {msg.text}
                  </span>
                </div>
              )
            }

            if (msg.kind === 'clarification') {
              return (
                <div key={msg.id} className="space-y-2">
                  <div className="rounded-2xl rounded-bl-sm border border-foreground/[0.06] bg-muted/40 px-3 py-2">
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground">
                      {msg.text}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {msg.candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCandidate(c)}
                        disabled={loading}
                        className="rounded-full border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-3 py-1.5 text-[12px] font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950/50 disabled:opacity-50 transition-colors"
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            }

            if (msg.kind === 'proposal') {
              const isSchedule = msg.proposal.kind === 'schedule_visit' || msg.proposal.kind === 'schedule_meeting'
              const replaceDone = (successText: string) => {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === msg.id
                      ? { kind: 'answer', id: m.id, text: successText, source: 'fallback' as const, refs: [], interactionId: null }
                      : m
                  )
                )
              }
              return (
                <div key={msg.id} className="space-y-2">
                  <div className="rounded-2xl rounded-bl-sm border border-foreground/[0.06] bg-muted/40 px-3 py-2">
                    <p className="text-[13px] leading-relaxed text-foreground">{msg.text}</p>
                  </div>
                  {isSchedule ? (
                    <ScheduleProposalCard
                      siteId={siteId}
                      proposal={msg.proposal}
                      interactionId={msg.interactionId}
                      planItemCount={planItems.length}
                      onDone={replaceDone}
                    />
                  ) : (
                    <ProposalCard
                      siteId={siteId}
                      proposal={msg.proposal}
                      interactionId={msg.interactionId}
                      onDone={replaceDone}
                      onPlanChange={() => { fetchPlanItems(siteId).then(setPlanItems).catch(() => {}) }}
                    />
                  )}
                </div>
              )
            }

            if (msg.kind === 'answer') {
              return (
                <div key={msg.id} className="space-y-2">
                  <div className="rounded-2xl rounded-bl-sm border border-foreground/[0.06] bg-muted/40 px-3 py-2">
                    <p className="whitespace-pre-line text-[14px] leading-relaxed text-foreground">
                      {msg.text}
                    </p>
                  </div>
                  {msg.refs.filter((r) => r.href !== null).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {msg.refs
                        .filter((r) => r.href !== null)
                        .map((ref) => (
                          <Link
                            key={ref.id}
                            href={ref.href!}
                            onClick={() => {
                              if (msg.interactionId) {
                                void trackCopilotReferenceClick({ interactionId: msg.interactionId, siteId })
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-foreground/10 bg-background px-2.5 py-1 text-[12px] font-medium text-foreground/70 hover:bg-muted"
                          >
                            Voir {ref.label}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ))}
                    </div>
                  )}
                  {msg.source === 'fallback' && (
                    <p className="text-[11px] text-muted-foreground">
                      Réponse déterministe — assistant IA temporairement indisponible.
                    </p>
                  )}
                </div>
              )
            }

            return null
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Zone de saisie */}
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Posez une question sur ce chantier…"
          disabled={loading}
          className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-400/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !inputText.trim()}
          aria-label="Envoyer"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40 transition-colors"
        >
          {loading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <SendHorizontal className="h-4 w-4" />
          }
        </button>
      </form>

      {/* Plan de prochaine visite — zone fixe hors conversation */}
      {planItems.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/60">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Plan de prochaine visite · {planItems.length} point{planItems.length > 1 ? 's' : ''}
          </p>
          <ul className="space-y-2">
            {planItems.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] font-medium">{item.label}</span>
                    {item.priority !== 'normal' && (
                      <span className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                        item.priority === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700',
                      )}>
                        {item.priority === 'critical' ? 'Critique' : 'Important'}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/50">
                      {item.sourceKind === 'copilot_suggestion' ? 'Copilote' : item.sourceKind === 'manual' ? 'Manuel' : 'MemorIA'}
                    </span>
                  </div>
                  {item.reason && (
                    <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">{item.reason}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label="Retirer du plan"
                  className="shrink-0 p-0.5 text-muted-foreground/40 hover:text-foreground transition-colors mt-0.5"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
