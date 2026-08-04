'use client'

import { useState, useRef, useEffect, type FormEvent } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, ExternalLink, SendHorizontal } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  askCopilotFreeAction,
  type CopilotFreeResult,
  type CopilotFreeCandidate,
} from '@/app/(dashboard)/sites/[id]/copilot-free-action'
import { askCopilotAction, type CopilotActionResult } from '@/app/(dashboard)/sites/[id]/copilot-action'
import type { CopilotIntent } from '@/lib/visits/copilot-context'

// ── Types ─────────────────────────────────────────────────────────────────────

type Msg =
  | { kind: 'user';          id: string; text: string }
  | { kind: 'answer';        id: string; text: string; source: 'llm' | 'fallback'; refs: { id: string; label: string; href: string | null }[] }
  | { kind: 'clarification'; id: string; text: string; candidates: CopilotFreeCandidate[] }
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

export function CopilotMobileSheet({ siteId }: { siteId: string }) {
  const [open, setOpen]                      = useState(false)
  const [messages, setMessages]              = useState<Msg[]>([])
  const [inputText, setInputText]            = useState('')
  const [loading, setLoading]                = useState(false)
  const [resolvedSubjectIds, setResolvedIds] = useState<string[]>([])
  const bottomRef                            = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  function closeSheet(v: boolean) {
    setOpen(v)
    if (!v) {
      setMessages([])
      setInputText('')
      setResolvedIds([])
    }
  }

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

    const userMsg: Msg    = { kind: 'user', id: uid(), text: question }
    const thinkingMsg: Msg = { kind: 'thinking', id: uid() }
    setMessages((prev) => [...prev, userMsg, thinkingMsg])
    setInputText('')

    const allResolvedIds = [...resolvedSubjectIds, ...(extraResolvedIds ?? [])]

    try {
      const result: CopilotFreeResult = await askCopilotFreeAction({
        siteId,
        question,
        history: buildHistory(),
        resolvedSubjectIds: allResolvedIds,
      })

      setMessages((prev) => {
        const without = prev.filter((m) => m.kind !== 'thinking')
        if (result.kind === 'answer') {
          return [...without, { kind: 'answer', id: uid(), text: result.text, source: result.source, refs: result.references }]
        }
        if (result.kind === 'clarification') {
          return [...without, { kind: 'clarification', id: uid(), text: result.text, candidates: result.candidates }]
        }
        return [...without, { kind: 'answer', id: uid(), text: result.text, source: 'fallback', refs: [] }]
      })
    } catch {
      setMessages((prev) => {
        const without = prev.filter((m) => m.kind !== 'thinking')
        return [...without, { kind: 'answer', id: uid(), text: 'Réessayez dans quelques instants.', source: 'fallback', refs: [] }]
      })
    } finally {
      setLoading(false)
    }
  }

  async function sendQuick(intent: CopilotIntent, label: string) {
    if (loading) return
    setLoading(true)

    const userMsg: Msg    = { kind: 'user', id: uid(), text: label }
    const thinkingMsg: Msg = { kind: 'thinking', id: uid() }
    setMessages((prev) => [...prev, userMsg, thinkingMsg])

    try {
      const result: CopilotActionResult = await askCopilotAction({ siteId, intent })
      setMessages((prev) => {
        const without = prev.filter((m) => m.kind !== 'thinking')
        return [...without, { kind: 'answer', id: uid(), text: result.text, source: result.source, refs: result.references }]
      })
    } catch {
      setMessages((prev) => prev.filter((m) => m.kind !== 'thinking'))
    } finally {
      setLoading(false)
    }
  }

  function selectCandidate(c: CopilotFreeCandidate) {
    setResolvedIds((prev) => [...prev, c.id])
    send(`Parle-moi de ${c.label}`, [c.id])
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(inputText)
  }

  const hasMessages = messages.length > 0

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-violet-300 bg-violet-50/50 px-4 py-3 text-left dark:border-violet-800/50 dark:bg-violet-950/10 active:opacity-70"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
        <span className="text-[13px] font-medium text-violet-700 dark:text-violet-300">
          Demander à MemorIA
        </span>
      </button>

      <Sheet open={open} onOpenChange={closeSheet}>
        <SheetContent side="bottom" className="flex flex-col max-h-[90svh] rounded-t-2xl px-4 pb-safe-area-inset-bottom">
          <SheetHeader className="mb-3 flex-none">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Demander à MemorIA
            </SheetTitle>
          </SheetHeader>

          {/* Raccourcis — visibles uniquement si conversation vide */}
          {!hasMessages && (
            <div className="flex-none flex flex-col gap-2 mb-3">
              {QUICK_QUESTIONS.map(({ intent, label }) => (
                <button
                  key={intent}
                  type="button"
                  onClick={() => sendQuick(intent, label)}
                  disabled={loading}
                  className="rounded-xl border border-border bg-background px-4 py-3 text-[14px] font-medium text-left text-foreground/70 hover:bg-muted disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Historique */}
          {hasMessages && (
            <div className="flex-1 overflow-y-auto space-y-3 mb-3 min-h-0">
              {messages.map((msg) => {
                if (msg.kind === 'thinking') {
                  return (
                    <div key={msg.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Analyse…
                    </div>
                  )
                }

                if (msg.kind === 'user') {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <span className="max-w-[85%] rounded-2xl rounded-br-sm bg-violet-100 dark:bg-violet-950/40 px-3 py-2 text-[13px] text-violet-900 dark:text-violet-100">
                        {msg.text}
                      </span>
                    </div>
                  )
                }

                if (msg.kind === 'clarification') {
                  return (
                    <div key={msg.id} className="space-y-2">
                      <div className="rounded-2xl rounded-bl-sm border border-foreground/[0.06] bg-muted/40 px-3 py-2">
                        <p className="whitespace-pre-line text-[14px] leading-relaxed text-foreground">
                          {msg.text}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        {msg.candidates.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectCandidate(c)}
                            disabled={loading}
                            className="rounded-xl border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-4 py-2.5 text-[13px] font-medium text-left text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950/50 disabled:opacity-50"
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
                        <div className="flex flex-col gap-2">
                          {msg.refs
                            .filter((r) => r.href !== null)
                            .map((ref) => (
                              <Link
                                key={ref.id}
                                href={ref.href!}
                                onClick={() => setOpen(false)}
                                className="inline-flex items-center gap-1 rounded-lg border border-foreground/10 bg-background px-2.5 py-2 text-[13px] font-medium text-foreground/70 active:opacity-70"
                              >
                                Voir {ref.label}
                                <ExternalLink className="ml-auto h-3 w-3" />
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

          {/* Input fixe en bas */}
          <form onSubmit={onSubmit} className="flex-none flex items-center gap-2 pt-2 border-t border-foreground/[0.06]">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Posez une question…"
              disabled={loading}
              className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-[14px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-400/40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !inputText.trim()}
              aria-label="Envoyer"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40 transition-colors"
            >
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <SendHorizontal className="h-4 w-4" />
              }
            </button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}
