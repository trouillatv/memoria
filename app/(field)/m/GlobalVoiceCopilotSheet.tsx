'use client'

import { useState, useRef, useEffect, type FormEvent } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, ExternalLink, SendHorizontal, Search } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  askCopilotFreeAction,
  type CopilotFreeResult,
  type CopilotFreeCandidate,
} from '@/app/(dashboard)/sites/[id]/copilot-free-action'
import type { CopilotProposal } from '@/lib/visits/copilot-proposal'
import { ProposalCard, ScheduleProposalCard, ObservationProposalCard, ActorAliasProposalCard } from '@/components/copilot/CopilotProposalCards'
import { CopilotAnswer } from '@/components/copilot/CopilotAnswer'
import { VoiceCopilotTrigger } from '@/components/field/VoiceCopilotTrigger'
import { useVoiceOrb, type VoiceTurnHandlers, type VoiceTurnPayload, type VoiceTurnResult } from './VoiceOrbContext'
import { listMeetingSitesAction } from './meeting-actions'
import { speak } from '@/lib/voice/speech-output'
import { markVoice } from '@/lib/voice/voice-latency'
import { traceVoice } from '@/lib/voice/voice-trace'
import { askCopilotVoiceTurnStreamed, type CopilotTurnDiag } from '@/lib/voice/copilot-stream-client'

// ── Types ─────────────────────────────────────────────────────────────────────

type Site = { id: string; name: string }

type Msg =
  | { kind: 'user';          id: string; text: string }
  | { kind: 'answer';        id: string; text: string; source: 'llm' | 'fallback' | 'deterministic'; refs: { id: string; label: string; href: string | null }[] }
  | { kind: 'clarification'; id: string; text: string; candidates: CopilotFreeCandidate[] }
  | { kind: 'proposal';      id: string; text: string; proposal: CopilotProposal; interactionId: string | null }
  | { kind: 'thinking';      id: string }

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

// ── Sélecteur de chantier ─────────────────────────────────────────────────────

function SitePicker({ onSelect }: { onSelect: (site: Site) => void }) {
  const [sites, setSites]   = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery]   = useState('')

  useEffect(() => {
    listMeetingSitesAction()
      .then(setSites)
      .finally(() => setLoading(false))
  }, [])

  const filtered = query.trim()
    ? sites.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
    : sites

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted-foreground">Sur quel chantier souhaitez-vous poser une question ou créer quelque chose ?</p>

      {sites.length > 5 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un chantier…"
            className="w-full rounded-xl border border-border bg-background pl-9 pr-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
          />
        </div>
      )}

      <ul className="space-y-2 max-h-[55svh] overflow-y-auto">
        {filtered.map((site) => (
          <li key={site.id}>
            <button
              type="button"
              onClick={() => onSelect(site)}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left text-[14px] font-medium hover:bg-muted/40 active:bg-muted/60"
            >
              {site.name}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="py-4 text-center text-[13px] text-muted-foreground">
            Aucun chantier trouvé
          </li>
        )}
      </ul>
    </div>
  )
}

// ── Chat copilote (après sélection du chantier) ────────────────────────────────

function CopilotChat({ siteId, siteName }: { siteId: string; siteName: string }) {
  const { openOrb } = useVoiceOrb()
  const [messages, setMessages]              = useState<Msg[]>([])
  const [inputText, setInputText]            = useState('')
  const [loading, setLoading]                = useState(false)
  const [resolvedSubjectIds, setResolvedIds] = useState<string[]>([])
  const bottomRef                            = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function buildHistory(): { role: 'user' | 'assistant'; content: string }[] {
    const result: { role: 'user' | 'assistant'; content: string }[] = []
    for (const m of messages.filter((m) => m.kind === 'user' || m.kind === 'answer').slice(-6)) {
      if (m.kind === 'user')   result.push({ role: 'user', content: m.text })
      if (m.kind === 'answer') result.push({ role: 'assistant', content: m.text })
    }
    return result
  }

  /** Remplace le « thinking » par le message correspondant au résultat. */
  function pushResultMessage(result: CopilotFreeResult) {
    setMessages((prev) => {
      const without = prev.filter((m) => m.kind !== 'thinking')
      if (result.kind === 'answer') {
        return [...without, { kind: 'answer' as const, id: uid(), text: result.text, source: result.source, refs: result.references }]
      }
      if (result.kind === 'clarification') {
        return [...without, { kind: 'clarification' as const, id: uid(), text: result.text, candidates: result.candidates }]
      }
      if (result.kind === 'proposal') {
        return [...without, { kind: 'proposal' as const, id: uid(), text: result.text, proposal: result.proposal, interactionId: result.interactionId }]
      }
      return [...without, { kind: 'answer' as const, id: uid(), text: result.text, source: 'fallback' as const, refs: [] }]
    })
  }

  /** Question TAPÉE — transport non streamé, jamais de lecture vocale. */
  async function send(question: string, extraResolvedIds?: string[]): Promise<VoiceTurnResult> {
    if (loading || !question.trim()) return {}
    setLoading(true)

    const userMsg: Msg    = { kind: 'user', id: uid(), text: question }
    const thinkingMsg: Msg = { kind: 'thinking', id: uid() }
    setMessages((prev) => [...prev, userMsg, thinkingMsg])
    setInputText('')

    const allResolvedIds = [...resolvedSubjectIds, ...(extraResolvedIds ?? [])]

    try {
      const result = await askCopilotFreeAction({
        siteId, question, history: buildHistory(), resolvedSubjectIds: allResolvedIds,
      })
      pushResultMessage(result)
      return result.kind === 'proposal' ? {} : { answer: result.text }
    } catch {
      setMessages((prev) => {
        const without = prev.filter((m) => m.kind !== 'thinking')
        return [...without, { kind: 'answer', id: uid(), text: 'Réessayez dans quelques instants.', source: 'fallback', refs: [] }]
      })
      return {}
    } finally {
      setLoading(false)
    }
  }

  /**
   * Tour VOCAL complet. L'orbe rend soit un transcript déjà normalisé (Gemini
   * Live a transcrit sur le téléphone), soit l'audio brut (repli de panne : le
   * serveur transcrit ET répond dans la même requête, contexte chantier chargé
   * pendant le STT). La feuille ne distingue pas les deux : même appel, même
   * suite. Une question parlée est aussi lue à l'oral ; une question tapée
   * (`send`) reste silencieuse.
   */
  async function sendVoiceTurn(
    turn: VoiceTurnPayload,
    handlers: VoiceTurnHandlers,
  ): Promise<VoiceTurnResult> {
    // Tracé avant le garde : un `loading` resté vrai avalerait le tour suivant
    // en silence, et c'est exactement ce qu'on cherche à écarter ou à prouver.
    traceVoice('sheet-send', {
      surface: 'global', loading, mode: 'voice', stt: turn.kind === 'transcript' ? 'live' : 'server',
      audioBytes: turn.kind === 'audio' ? turn.audio.size : 0,
    })
    if (loading) throw new Error('sheet busy')
    setLoading(true)

    let transcriptText: string | null = null
    let spokenAnnounced = false
    let spokenCaptured: string | null = null
    let diagCaptured: CopilotTurnDiag | null = null
    // Raw STT disponible uniquement sur le chemin Live — nul sur le chemin audio.
    const rawStt = turn.kind === 'transcript' ? (turn.rawText ?? null) : null
    try {
      const outcome = await askCopilotVoiceTurnStreamed(
        { siteId, turn, history: buildHistory(), resolvedSubjectIds },
        {
          onTranscript: (text) => {
            transcriptText = text
            const keepGoing = handlers.onTranscript(text)
            if (keepGoing) {
              // La question entre dans la feuille au moment où elle est connue,
              // exactement comme une question tapée.
              setMessages((prev) => [...prev, { kind: 'user', id: uid(), text }, { kind: 'thinking', id: uid() }])
            }
            return keepGoing
          },
          onDiag: (diag) => {
            diagCaptured = diag
          },
          onSpokenReady: (spokenText) => {
            spokenAnnounced = true
            spokenCaptured = spokenText
            markVoice('spokenReady')
            const accepted = speak(spokenText)
            traceVoice('speak-returned', { accepted, transport: 'voice-stream' })
          },
        },
      )

      if (outcome.aborted) return {}

      let result = outcome.result
      if (!result) {
        // Échec avant transcript → l'orbe affiche l'erreur de transcription.
        if (!outcome.transcript) throw new Error('voice turn failed before transcript')
        // Repli propre sur le transport non streamé (contrainte Vincent #8) :
        // le transcript est acquis, seule la réponse streamée a échoué.
        traceVoice('stream-fallback', { reason: 'voice-stream failed after transcript' })
        result = await askCopilotFreeAction({
          siteId, question: outcome.transcript, history: buildHistory(), resolvedSubjectIds,
        })
      }

      // Le repli déterministe DANS le flux (provider en échec pendant le
      // streaming) ne passe jamais par `onSpokenReady` — si la voix n'a encore
      // rien dit, on la déclenche sur la synthèse du résultat final.
      if (!spokenAnnounced && result.kind === 'answer') {
        const accepted = speak(result.spokenText)
        traceVoice('speak-returned', { accepted, transport: 'voice-final' })
      }

      const spoken = result.kind === 'answer' ? result.spokenText : null
      traceVoice('answer', {
        kind: result.kind,
        source: result.kind === 'answer' ? result.source : null,
        spokenText: result.kind === 'answer' ? (spoken == null ? 'null' : 'present') : 'n/a',
        spokenLength: spoken?.length ?? 0,
      })

      // Trace sémantique bout-en-bout — lisible dans le panneau ?voicedebug=1.
      // C'est la chaîne complète qui manquait pour diagnostiquer P3-B.
      // TS 5.9 narrowe les let mutés en closure vers null — `as` bloque le narrowing.
      const _diag = diagCaptured as CopilotTurnDiag | null
      const _spoken = spokenCaptured as string | null
      traceVoice('turn-semantic', {
        // Étage STT
        rawStt: rawStt ?? transcriptText ?? '?',
        normalized: transcriptText ?? '?',
        sttRoute: turn.kind === 'transcript' ? 'live' : 'server',
        // Étage routage (vient du serveur via SSE diag)
        det: _diag != null ? _diag.det : '?',
        merged: _diag != null ? _diag.merged : '?',
        family: _diag != null ? _diag.family : '?',
        applied: _diag != null ? _diag.applied : '—',
        // Étage réponse
        answerKind: result.kind,
        answerSource: result.kind === 'answer' ? result.source : null,
        spokenLength: _spoken != null ? _spoken.length : 0,
        spoken: _spoken != null ? _spoken.slice(0, 120) : null,
        answerLength: result.kind === 'answer' ? result.text.length : null,
        answer: result.kind === 'answer' ? result.text.slice(0, 150) : null,
      })

      pushResultMessage(result)
      // Ce que l'orbe affichera dans son fil. Une proposition en est exclue :
      // elle se valide dans la feuille, pas dans la conversation vocale.
      return result.kind === 'proposal' ? {} : { answer: result.text }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.kind !== 'thinking'))
      if (transcriptText === null) throw err instanceof Error ? err : new Error('voice turn failed')
      setMessages((prev) => [...prev, { kind: 'answer', id: uid(), text: 'Réessayez dans quelques instants.', source: 'fallback', refs: [] }])
      return {}
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
    <div className="flex flex-col flex-1 min-h-0">
      <p className="flex-none text-[12px] text-muted-foreground mb-3">
        Chantier : <span className="font-medium text-foreground">{siteName}</span>
      </p>

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
                    <p className="whitespace-pre-line text-[14px] leading-relaxed text-foreground">{msg.text}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {msg.candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCandidate(c)}
                        disabled={loading}
                        className="rounded-xl border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-4 py-2.5 text-[13px] font-medium text-left text-violet-700 dark:text-violet-300 hover:bg-violet-100 disabled:opacity-50"
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
              const msgId = msg.id
              const replaceDone = (successText: string) => {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === msgId
                      ? { kind: 'answer' as const, id: m.id, text: successText, source: 'fallback' as const, refs: [] }
                      : m
                  )
                )
              }
              return (
                <div key={msg.id} className="space-y-2">
                  <div className="rounded-2xl rounded-bl-sm border border-foreground/[0.06] bg-muted/40 px-3 py-2">
                    <p className="text-[14px] leading-relaxed text-foreground">{msg.text}</p>
                  </div>
                  {isSchedule ? (
                    <ScheduleProposalCard
                      siteId={siteId}
                      proposal={msg.proposal}
                      interactionId={msg.interactionId}
                      planItemCount={0}
                      onDone={replaceDone}
                    />
                  ) : msg.proposal.kind === 'observation' ? (
                    <ObservationProposalCard
                      siteId={siteId}
                      proposal={msg.proposal}
                      interactionId={msg.interactionId}
                      onDone={replaceDone}
                    />
                  ) : msg.proposal.kind === 'actor_alias' ? (
                    <ActorAliasProposalCard
                      siteId={siteId}
                      proposal={msg.proposal}
                      interactionId={msg.interactionId}
                      onDone={replaceDone}
                    />
                  ) : (
                    <ProposalCard
                      siteId={siteId}
                      proposal={msg.proposal}
                      interactionId={msg.interactionId}
                      onDone={replaceDone}
                    />
                  )}
                </div>
              )
            }

            if (msg.kind === 'answer') {
              return (
                <div key={msg.id} className="space-y-2">
                  <div className="rounded-2xl rounded-bl-sm border border-foreground/[0.06] bg-muted/40 px-3 py-2.5">
                    <CopilotAnswer text={msg.text} />
                  </div>
                  {msg.refs.filter((r) => r.href !== null).length > 0 && (
                    <div className="flex flex-col gap-2">
                      {msg.refs
                        .filter((r) => r.href !== null)
                        .map((ref) => (
                          <Link
                            key={ref.id}
                            href={ref.href!}
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

      {/* Input */}
      <form onSubmit={onSubmit} className="flex-none flex items-center gap-2 pt-2 border-t border-foreground/[0.06]">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Posez une question…"
          disabled={loading}
          className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-[14px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-400/40 disabled:opacity-50"
        />
        {/* L'audio part entier dans `sendVoiceTurn` — transcription et réponse
            reviennent par la même requête, sans écran de confirmation. */}
        <VoiceCopilotTrigger
          disabled={loading}
          onOpenOrb={() => openOrb({ siteId, siteName, onVoiceTurn: sendVoiceTurn })}
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
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────

export function GlobalVoiceCopilotSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [selectedSite, setSelectedSite] = useState<Site | null>(null)

  function handleOpenChange(v: boolean) {
    if (!v) {
      onClose()
      setSelectedSite(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="flex flex-col max-h-[90svh] rounded-t-2xl px-4 pb-safe-area-inset-bottom">
        <SheetHeader className="mb-3 flex-none">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-500" />
            Parler à MemorIA
          </SheetTitle>
        </SheetHeader>

        {selectedSite ? (
          <CopilotChat siteId={selectedSite.id} siteName={selectedSite.name} />
        ) : (
          <SitePicker onSelect={setSelectedSite} />
        )}
      </SheetContent>
    </Sheet>
  )
}
