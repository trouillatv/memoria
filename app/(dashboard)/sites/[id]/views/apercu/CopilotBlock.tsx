'use client'

// Copilote Phase 3 — conversation libre, lecture seule.
// Les 4 questions rapides restent comme raccourcis.
// L'historique est maintenu localement (3 échanges max, stateless côté serveur).
// Les liens suggested ne sont jamais envoyés au LLM (filtrage côté serveur).

import { useState, useRef, useEffect, type FormEvent } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, ExternalLink, SendHorizontal, X } from 'lucide-react'
import {
  askCopilotFreeAction,
  type CopilotFreeResult,
  type CopilotFreeCandidate,
} from '../../copilot-free-action'
import { askCopilotAction, type CopilotActionResult } from '../../copilot-action'
import type { CopilotIntent } from '@/lib/visits/copilot-context'

// ── Types locaux ──────────────────────────────────────────────────────────────

type Msg =
  | { kind: 'user';        id: string; text: string }
  | { kind: 'answer';      id: string; text: string; source: 'llm' | 'fallback'; refs: { id: string; label: string; href: string | null }[] }
  | { kind: 'clarification'; id: string; text: string; candidates: CopilotFreeCandidate[] }
  | { kind: 'thinking';    id: string }

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
  const bottomRef                             = useRef<HTMLDivElement>(null)

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

  async function send(question: string, extraResolvedIds?: string[]) {
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
          }]
        }
        if (result.kind === 'clarification') {
          return [...withoutThinking, {
            kind: 'clarification',
            id: uid(),
            text: result.text,
            candidates: result.candidates,
          }]
        }
        // write_not_supported
        return [...withoutThinking, {
          kind: 'answer',
          id: uid(),
          text: result.text,
          source: 'fallback',
          refs: [],
        }]
      })
    } catch {
      setMessages((prev) => {
        const withoutThinking = prev.filter((m) => m.kind !== 'thinking')
        return [...withoutThinking, {
          kind: 'answer', id: uid(),
          text: 'Une erreur est survenue. Réessayez dans quelques instants.',
          source: 'fallback', refs: [],
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
      const result: CopilotActionResult = await askCopilotAction({ siteId, intent })
      setMessages((prev) => {
        const withoutThinking = prev.filter((m) => m.kind !== 'thinking')
        return [...withoutThinking, {
          kind: 'answer', id: uid(),
          text: result.text, source: result.source,
          refs: result.references,
        }]
      })
    } catch {
      setMessages((prev) => prev.filter((m) => m.kind !== 'thinking'))
    } finally {
      setLoading(false)
    }
  }

  // Sélection d'un candidat après clarification
  function selectCandidate(candidate: CopilotFreeCandidate) {
    setResolvedIds((prev) => [...prev, candidate.id])
    send(`Parle-moi de ${candidate.label}`, [candidate.id])
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
    </section>
  )
}
