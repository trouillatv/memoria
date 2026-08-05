'use client'

// Copilote Phase 3 — conversation libre + propositions (3C).
// Les 4 questions rapides restent comme raccourcis.
// L'historique est maintenu localement (3 échanges max, stateless côté serveur).
// Les liens suggested ne sont jamais envoyés au LLM (filtrage côté serveur).

import { useState, useRef, useEffect, type FormEvent } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, ExternalLink, SendHorizontal, ChevronDown, ChevronUp, Check, X } from 'lucide-react'
import {
  askCopilotFreeAction,
  type CopilotFreeResult,
  type CopilotFreeCandidate,
} from '../../copilot-free-action'
import { askCopilotAction, type CopilotActionResult } from '../../copilot-action'
import { createCopilotAction, addCopilotToBriefing, createCopilotScheduledEvent } from '../../copilot-write-action'
import { trackCopilotReferenceClick, trackCopilotProposalCancelled } from '../../copilot-event-action'
import { fetchPlanItems, removePlanItem, type PlanItemSummary } from '../../copilot-plan-actions'
import type { CopilotIntent } from '@/lib/visits/copilot-context'
import type { CopilotProposal } from '@/lib/visits/copilot-proposal'
import { cn } from '@/lib/utils'

// ── Types locaux ──────────────────────────────────────────────────────────────

type Msg =
  | { kind: 'user';          id: string; text: string }
  | { kind: 'answer';        id: string; text: string; source: 'llm' | 'fallback'; refs: { id: string; label: string; href: string | null }[]; interactionId: string | null }
  | { kind: 'clarification'; id: string; text: string; candidates: CopilotFreeCandidate[]; interactionId: string | null }
  | { kind: 'proposal';      id: string; text: string; proposal: CopilotProposal; interactionId: string | null }
  | { kind: 'thinking';      id: string }

// ── Carte de proposition 3C ───────────────────────────────────────────────────

const CONFIDENCE_LABELS: Record<CopilotProposal['confidence'], string> = {
  strong:     'Je recommande fortement',
  medium:     'Je recommande',
  suggestion: 'Suggestion',
}
const CONFIDENCE_CLASSES: Record<CopilotProposal['confidence'], string> = {
  strong:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  medium:     'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  suggestion: 'bg-muted text-muted-foreground',
}

function ProposalCard({
  siteId,
  proposal,
  interactionId,
  onDone,
  onPlanChange,
}: {
  siteId: string
  proposal: CopilotProposal
  interactionId: string | null
  onDone: (successText: string) => void
  onPlanChange?: () => void
}) {
  const [title, setTitle] = useState(proposal.title)
  const [body, setBody] = useState(proposal.body ?? '')
  const [whyOpen, setWhyOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cancelled, setCancelled] = useState(false)

  if (cancelled) {
    return (
      <p className="text-[12px] text-muted-foreground italic">Proposition annulée.</p>
    )
  }

  async function confirm() {
    if (saving || !title.trim()) return
    setSaving(true)
    try {
      if (proposal.kind === 'action') {
        const res = await createCopilotAction({
          siteId,
          title: title.trim(),
          body: body.trim() || null,
          canonicalSubjectId: proposal.canonicalSubjectId,
          copilotProposalId: proposal.proposalId,
          llmModel: proposal.llmModel,
          promptVersion: proposal.promptVersion,
          interactionId,
        })
        if (res.ok) {
          onDone('Action créée.')
        } else {
          onDone(`Erreur : ${res.error}`)
        }
      } else {
        const res = await addCopilotToBriefing({
          siteId,
          label: title.trim(),
          canonicalSubjectId: proposal.canonicalSubjectId,
          copilotProposalId: proposal.proposalId,
          interactionId,
          reason: proposal.whyText,
        })
        if (res.ok) {
          onDone('Ajouté au plan de prochaine visite.')
          onPlanChange?.()
        } else {
          onDone(`Erreur : ${res.error}`)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  const kindLabel = proposal.kind === 'action' ? 'Action' : 'Point de visite'

  return (
    <div className="rounded-2xl border border-foreground/10 bg-card p-3 space-y-2.5">
      {/* En-tête : badge confiance + nature */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', CONFIDENCE_CLASSES[proposal.confidence])}>
          {CONFIDENCE_LABELS[proposal.confidence]}
        </span>
        <span className="text-[11px] text-muted-foreground">{kindLabel}</span>
      </div>

      {/* Titre éditable */}
      <div>
        <label className="block text-[11px] text-muted-foreground mb-0.5">Titre</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
        />
      </div>

      {/* Corps — seulement pour les actions */}
      {proposal.kind === 'action' && (
        <div>
          <label className="block text-[11px] text-muted-foreground mb-0.5">Détail (optionnel)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Précisions, contexte…"
            className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
          />
        </div>
      )}

      {/* Lignes info — non éditables */}
      <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border text-[12px]">
        {proposal.canonicalSubjectLabel && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="w-28 shrink-0 text-muted-foreground">Sujet suivi</span>
            <span className="font-medium">{proposal.canonicalSubjectLabel}</span>
          </div>
        )}
        {proposal.kind === 'action' && (
          <>
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="w-28 shrink-0 text-muted-foreground">Responsable</span>
              <span className="italic text-muted-foreground">Non attribué</span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="w-28 shrink-0 text-muted-foreground">Échéance</span>
              <span className="italic text-muted-foreground">Non définie</span>
            </div>
          </>
        )}
        {proposal.kind === 'visit_item' && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="w-28 shrink-0 text-muted-foreground">Priorité</span>
            <span className="italic text-muted-foreground">Normale</span>
          </div>
        )}
      </div>

      {/* Pourquoi ? — section dépliable */}
      <button
        type="button"
        onClick={() => setWhyOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {whyOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Pourquoi cette proposition ?
      </button>
      {whyOpen && (
        <p className="text-[12px] text-muted-foreground leading-relaxed pl-4 border-l border-border">
          {proposal.whyText}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          onClick={confirm}
          disabled={saving || !title.trim()}
          className="flex items-center gap-1.5 rounded-full bg-violet-500 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-violet-600 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Valider
        </button>
        <button
          type="button"
          onClick={() => {
            setCancelled(true)
            if (interactionId) void trackCopilotProposalCancelled({ interactionId, siteId })
          }}
          disabled={saving}
          className="rounded-full border border-border px-3.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

// ── Carte de planification (schedule_visit / schedule_meeting) ────────────────

function ScheduleProposalCard({
  siteId,
  proposal,
  interactionId,
  planItemCount,
  onDone,
}: {
  siteId: string
  proposal: CopilotProposal
  interactionId: string | null
  planItemCount: number
  onDone: (successText: string) => void
}) {
  const [title, setTitle]         = useState(proposal.title)
  const [date, setDate]           = useState(proposal.scheduledDate ?? '')
  const [time, setTime]           = useState(proposal.scheduledTime ?? '')
  const [objective, setObjective] = useState(proposal.scheduledObjective ?? '')
  const [whyOpen, setWhyOpen]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [cancelled, setCancelled] = useState(false)

  if (cancelled) {
    return <p className="text-[12px] text-muted-foreground italic">Proposition annulée.</p>
  }

  const isVisit     = proposal.kind === 'schedule_visit'
  const typeLabel   = isVisit ? 'Visite' : 'Réunion'
  const objectiveLabel = isVisit ? 'Objectif' : 'Ordre du jour'
  const canConfirm  = !!title.trim() && !!date && !!time

  async function confirm() {
    if (saving || !canConfirm) return
    setSaving(true)
    try {
      const res = await createCopilotScheduledEvent({
        siteId,
        type: isVisit ? 'visit' : 'meeting',
        title: title.trim(),
        scheduledDate: date,
        scheduledTime: time,
        objective: objective.trim() || null,
        copilotProposalId: proposal.proposalId,
        interactionId,
      })
      onDone(res.ok ? `${typeLabel} planifiée.` : `Erreur : ${res.error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-foreground/10 bg-card p-3 space-y-2.5">
      {/* En-tête */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 px-2 py-0.5 text-[11px] font-medium">
          Planification
        </span>
        <span className="text-[11px] text-muted-foreground">{typeLabel}</span>
      </div>

      {/* Titre */}
      <div>
        <label className="block text-[11px] text-muted-foreground mb-0.5">Titre</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
        />
      </div>

      {/* Date + Heure */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-0.5">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
          />
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground mb-0.5">Heure (Nouméa)</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
          />
        </div>
      </div>

      {/* Objectif / Agenda */}
      <div>
        <label className="block text-[11px] text-muted-foreground mb-0.5">{objectiveLabel} (optionnel)</label>
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={2}
          maxLength={500}
          className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
        />
      </div>

      {/* Lignes info — non éditables */}
      <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border text-[12px]">
        {isVisit && planItemCount > 0 && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="w-28 shrink-0 text-muted-foreground">Plan de visite</span>
            <span className="font-medium">{planItemCount} point{planItemCount > 1 ? 's' : ''} prêt{planItemCount > 1 ? 's' : ''}</span>
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="w-28 shrink-0 text-muted-foreground">Fuseau</span>
          <span className="italic text-muted-foreground">Pacific/Nouméa (UTC+11)</span>
        </div>
      </div>

      {/* Pourquoi ? */}
      <button
        type="button"
        onClick={() => setWhyOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {whyOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Détails
      </button>
      {whyOpen && (
        <p className="text-[12px] text-muted-foreground leading-relaxed pl-4 border-l border-border">
          {proposal.whyText}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          onClick={confirm}
          disabled={saving || !canConfirm}
          className="flex items-center gap-1.5 rounded-full bg-violet-500 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-violet-600 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Valider
        </button>
        <button
          type="button"
          onClick={() => {
            setCancelled(true)
            if (interactionId) void trackCopilotProposalCancelled({ interactionId, siteId })
          }}
          disabled={saving}
          className="rounded-full border border-border px-3.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

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
  // Plan de prochaine visite — chargé au montage, rafraîchi après ajout
  const [planItems, setPlanItems]             = useState<PlanItemSummary[]>([])
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

  // Sélection d'un candidat après clarification — bypasse la résolution lexicale
  function selectCandidate(candidate: CopilotFreeCandidate) {
    setResolvedIds((prev) => [...prev, candidate.id])
    send(`Parle-moi de ${candidate.label}`, [candidate.id], candidate.id)
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

      {/* Raccourcis — visibles uniquement si pas encore de conversation */}
      {!hasMessages && (
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_QUESTIONS.map(({ intent, label }) => (
            <button
              key={intent}
              type="button"
              onClick={() => sendQuick(intent, label)}
              disabled={loading}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-[13px] font-medium text-foreground/70 hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {label}
            </button>
          ))}
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
