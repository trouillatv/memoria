'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Loader2, X, Check, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { sendChatMessageAction, runAgentInitialAnalysisAction } from './atelier-actions'
import { toast } from 'sonner'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { AtelierMessageThread } from './AtelierMessageThread'
import { CopiloteHeroCard } from './CopiloteHeroCard'
import { cn } from '@/lib/utils'
import { pickThinkingPhrase } from './agent-thinking-phrases'
import { SLASH_COMMANDS, type SlashCommand } from './slash-commands'
import type { ChatAgentName, DbTenderChatMessage, DbAgentAnalysis, DbTenderAnalysis, AgentAnalysisStatus } from '@/types/db'

const MAX_AGENTS = 3

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

// ---------------------------------------------------------------------------
// AgentPill sub-component
// ---------------------------------------------------------------------------

interface AgentPillProps {
  agentName: ChatAgentName
  selected: boolean
  status: AgentAnalysisStatus | undefined
  disabledForSelection: boolean
  isRunning: boolean
  onToggle: () => void
  onRunAnalysis: () => void
}

function AgentPill({ agentName, selected, status, disabledForSelection, isRunning, onToggle, onRunAnalysis }: AgentPillProps) {
  const colors = AGENT_COLORS[agentName]
  const meta = AGENTS[agentName]
  const Icon = meta.icon
  const effectiveStatus: AgentAnalysisStatus = status ?? 'pending'

  return (
    <div className="inline-flex items-center gap-0.5 shrink-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabledForSelection && !selected}
        className={cn(
          'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
          selected
            ? `border-2 ${colors.borderClass} ${colors.bgClass} ${colors.textClass}`
            : `border border-input ${colors.textClass} hover:bg-muted/50`,
          disabledForSelection && !selected && 'opacity-40 cursor-not-allowed'
        )}
        title={selected ? `${meta.label} — sélectionné pour le chat` : meta.label}
      >
        {selected && <Check className="h-3 w-3" />}
        <Icon className="h-3 w-3" />
        <span>{meta.label}</span>
        {/* Status indicator dot */}
        {effectiveStatus === 'ready' && (
          <span
            className={cn('w-1.5 h-1.5 rounded-full', colors.dotClass)}
            title="Analyse prête"
          />
        )}
        {effectiveStatus === 'running' && (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
        )}
        {effectiveStatus === 'failed' && (
          <AlertCircle className="h-2.5 w-2.5 text-rose-500" />
        )}
      </button>
      {/* "Analyser" / "Réessayer" button visible si pending ou failed */}
      {(effectiveStatus === 'pending' || effectiveStatus === 'failed') && (
        <button
          type="button"
          onClick={onRunAnalysis}
          disabled={isRunning}
          className={cn(
            'text-[10px] px-1.5 py-1 rounded text-muted-foreground hover:text-foreground hover:underline transition-colors',
            isRunning && 'opacity-50 cursor-not-allowed'
          )}
          title={effectiveStatus === 'failed' ? 'Réveiller cet agent (analyse précédente échouée)' : 'Briefer cet agent sur l\'AO'}
        >
          {effectiveStatus === 'failed' ? 'Réveiller' : 'Briefer'}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AtelierIATab
// ---------------------------------------------------------------------------

interface AtelierIATabProps {
  tenderId: string
  initialMessages: DbTenderChatMessage[]
  initialAgentAnalyses: DbAgentAnalysis[]
  tenderAnalysis: DbTenderAnalysis | null
  tenderTitle: string
}

export function AtelierIATab({ tenderId, initialMessages, initialAgentAnalyses, tenderAnalysis, tenderTitle }: AtelierIATabProps) {
  const [messages, setMessages] = useState<DbTenderChatMessage[]>(initialMessages)
  const [selectedAgents, setSelectedAgents] = useState<Set<ChatAgentName>>(() => new Set<ChatAgentName>(['general']))
  const [agentAnalyses, setAgentAnalyses] = useState<Map<ChatAgentName, DbAgentAnalysis>>(
    () => new Map(initialAgentAnalyses.map(a => [a.agent_name, a]))
  )
  const [analyzingAgents, setAnalyzingAgents] = useState<Set<ChatAgentName>>(new Set())
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [thinkingPhrases, setThinkingPhrases] = useState<Map<ChatAgentName, string>>(new Map())
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Slash command filtering
  const slashFilter = draft.startsWith('/') && !draft.includes(' ') ? draft.slice(1).toLowerCase() : null
  const slashFilteredCommands: SlashCommand[] = slashFilter !== null
    ? SLASH_COMMANDS.filter((c) => c.trigger.startsWith(slashFilter))
    : []
  const slashOpen = slashFilter !== null && slashFilteredCommands.length > 0

  // Auto scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Reset slashSelectedIdx when filter changes
  useEffect(() => {
    setSlashSelectedIdx(0)
  }, [slashFilter])

  function toggleAgent(agent: ChatAgentName) {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(agent)) {
        next.delete(agent)
      } else {
        if (next.size >= MAX_AGENTS) {
          toast.warning(`Max ${MAX_AGENTS} agents simultanés`)
          return prev
        }
        next.add(agent)
      }
      return next
    })
  }

  function applySlashCommand(cmd: SlashCommand) {
    setDraft(cmd.prompt)
    setSelectedAgents(new Set(cmd.agents.slice(0, MAX_AGENTS)))
    setSlashSelectedIdx(0)
    setTimeout(() => {
      const ta = document.querySelector('textarea[data-composer]') as HTMLTextAreaElement | null
      ta?.focus()
      if (ta) {
        ta.setSelectionRange(cmd.prompt.length, cmd.prompt.length)
      }
    }, 30)
  }

  async function runInitialAnalysis(agentName: ChatAgentName) {
    if (analyzingAgents.has(agentName)) return
    setAnalyzingAgents(prev => new Set(prev).add(agentName))

    // Optimistic : status running localement
    setAgentAnalyses(prev => {
      const next = new Map(prev)
      const existing = next.get(agentName)
      next.set(agentName, {
        ...(existing ?? {
          id: 'temp',
          tender_id: tenderId,
          agent_name: agentName,
          summary: null,
          key_points: null,
          raw_content: null,
          metadata: null,
          error_msg: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as DbAgentAnalysis),
        status: 'running',
      })
      return next
    })

    const fd = new FormData()
    fd.set('tender_id', tenderId)
    fd.set('agent_name', agentName)
    const r = await runAgentInitialAnalysisAction(fd)

    setAnalyzingAgents(prev => {
      const next = new Set(prev)
      next.delete(agentName)
      return next
    })

    if (r && 'error' in r && r.error) {
      toast.error(r.error)
      // Revert
      setAgentAnalyses(prev => {
        const next = new Map(prev)
        const existing = next.get(agentName)
        if (existing) next.set(agentName, { ...existing, status: 'pending' })
        return next
      })
    } else {
      toast.success(`Analyse ${AGENTS[agentName].label} lancée`)
      // Note : status passera de 'running' à 'ready' quand `after()` server termine.
      // Pour l'instant on garde l'état 'running' local jusqu'à ce que l'utilisateur recharge.
    }
  }

  async function send() {
    if (!draft.trim() || pending || selectedAgents.size === 0) return

    // Capture thinking phrases before pending
    const phrasesNow = new Map<ChatAgentName, string>()
    for (const a of selectedAgents) {
      phrasesNow.set(a, pickThinkingPhrase(a))
    }
    setThinkingPhrases(phrasesNow)
    setPending(true)

    // Optimistic add user message
    const optimisticUser: DbTenderChatMessage = {
      id: `temp-${Date.now()}`,
      tender_id: tenderId,
      user_id: null,
      agent_name: null,
      role: 'user',
      content: draft,
      metadata: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticUser])
    const sentDraft = draft
    const sentAttachment = attachment
    setDraft('')
    setAttachment(null)
    if (fileRef.current) fileRef.current.value = ''
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const fd = new FormData()
    fd.set('tender_id', tenderId)
    fd.set('agent_names', JSON.stringify(Array.from(selectedAgents)))
    fd.set('message', sentDraft)
    if (sentAttachment) fd.set('attachment', sentAttachment)

    const r = await sendChatMessageAction(fd)
    setPending(false)
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id))
      return
    }
    // Replace the optimistic placeholder by the real user message returned by
    // the action, then append the agent responses. No reload → l'onglet actif
    // est préservé.
    if (r && 'userMessage' in r && r.userMessage && r.agentMessages) {
      setMessages((prev) =>
        prev
          .filter((m) => m.id !== optimisticUser.id)
          .concat([r.userMessage as DbTenderChatMessage, ...(r.agentMessages as DbTenderChatMessage[])])
      )
    }
  }

  const firstAgent = selectedAgents.values().next().value as ChatAgentName | undefined

  function handleHeroPromptClick(prompt: string, agents: ChatAgentName[]) {
    setSelectedAgents(new Set(agents.slice(0, MAX_AGENTS)))
    setDraft(prompt)
    setTimeout(() => {
      const ta = document.querySelector('textarea[data-composer]') as HTMLTextAreaElement | null
      ta?.focus()
    }, 50)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread scrollable */}
      <div className="flex-1 overflow-y-auto pb-4 rounded-xl border bg-card p-3">
        <AtelierMessageThread
          messages={messages}
          tenderId={tenderId}
          pending={pending}
          onChallengeLaunched={(newMessages) => {
            setMessages((prev) => [...prev, ...newMessages])
          }}
          emptyState={
            <CopiloteHeroCard
              tenderTitle={tenderTitle}
              analysis={tenderAnalysis}
              onPromptClick={handleHeroPromptClick}
            />
          }
        />
        {pending && selectedAgents.size > 0 && (
          <div className="space-y-1.5 mt-3 px-1">
            {Array.from(selectedAgents).map((agentName) => {
              const meta = AGENTS[agentName]
              const colors = AGENT_COLORS[agentName]
              const Icon = meta.icon
              const phrase = thinkingPhrases.get(agentName) ?? 'Réfléchit…'
              return (
                <div key={agentName} className="flex items-center gap-2 text-xs">
                  <div className={cn('w-5 h-5 rounded-full flex items-center justify-center shrink-0', colors.bgClass)}>
                    <Icon className={cn('h-3 w-3', colors.textClass)} />
                  </div>
                  <span className={cn('font-medium', colors.textClass)}>{meta.label}</span>
                  <span className="text-muted-foreground italic flex-1">{phrase}</span>
                  <Loader2 className={cn('h-3 w-3 animate-spin', colors.textClass)} />
                </div>
              )
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Sticky composer */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t pt-3 pb-2 -mx-4 px-4">
        {/* Multi-agent helper */}
        {selectedAgents.size > 1 && (
          <p className="text-xs text-muted-foreground italic mb-2">
            Les {selectedAgents.size} agents répondront en parallèle
          </p>
        )}

        {/* Compteur + pills */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-xs text-muted-foreground">Agents IA</Label>
            <span className="text-xs text-muted-foreground">{selectedAgents.size}/{MAX_AGENTS}</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
            {(Object.keys(AGENTS) as ChatAgentName[]).map((agentName) => {
              const analysis = agentAnalyses.get(agentName)
              const selected = selectedAgents.has(agentName)
              const wouldExceed = !selected && selectedAgents.size >= MAX_AGENTS
              const isRunning = analyzingAgents.has(agentName)
              return (
                <AgentPill
                  key={agentName}
                  agentName={agentName}
                  selected={selected}
                  status={analysis?.status}
                  disabledForSelection={wouldExceed}
                  isRunning={isRunning}
                  onToggle={() => toggleAgent(agentName)}
                  onRunAnalysis={() => runInitialAnalysis(agentName)}
                />
              )
            })}
          </div>
        </div>

        {/* Textarea with slash command menu */}
        <div className="relative">
          {slashOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border bg-popover shadow-lg z-10 overflow-hidden">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-b bg-muted/30">
                Commande rapide
              </div>
              <ul className="max-h-64 overflow-y-auto">
                {slashFilteredCommands.map((cmd, idx) => {
                  const Icon = cmd.icon
                  const isSelected = idx === slashSelectedIdx
                  return (
                    <li key={cmd.trigger}>
                      <button
                        type="button"
                        onClick={() => applySlashCommand(cmd)}
                        onMouseEnter={() => setSlashSelectedIdx(idx)}
                        className={cn(
                          'w-full flex items-start gap-2 px-3 py-2 text-left transition-colors',
                          isSelected ? 'bg-accent' : 'hover:bg-muted/50'
                        )}
                      >
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium font-mono">{cmd.label}</div>
                          <div className="text-xs text-muted-foreground line-clamp-1">{cmd.description}</div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="px-2 py-1 text-[10px] text-muted-foreground border-t bg-muted/20">
                ↑ ↓ pour naviguer · Entrée pour appliquer · Esc pour fermer
              </div>
            </div>
          )}
          <textarea
            ref={textareaRef}
            data-composer="true"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); autoGrow(e.currentTarget) }}
            placeholder={
              selectedAgents.size === 0
                ? 'Sélectionne au moins 1 agent…'
                : selectedAgents.size === 1 && firstAgent
                  ? `Demande à l'agent ${AGENTS[firstAgent].label} de creuser cet AO… (ex: « Quels sont les 3 risques cachés ? »)`
                  : `Demande à tes ${selectedAgents.size} agents de creuser cet AO en parallèle…`
            }
            rows={2}
            disabled={pending}
            onKeyDown={(e) => {
              if (slashOpen) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSlashSelectedIdx((i) => Math.min(i + 1, slashFilteredCommands.length - 1))
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSlashSelectedIdx((i) => Math.max(i - 1, 0))
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  applySlashCommand(slashFilteredCommands[slashSelectedIdx])
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setDraft('')
                  return
                }
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                send()
              }
            }}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 mb-2"
            style={{ minHeight: '60px', maxHeight: '200px', overflow: 'hidden' }}
          />
        </div>

        {/* Actions row */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={pending}
            >
              <Paperclip className="h-3 w-3 mr-1" />
              {attachment ? attachment.name.slice(0, 20) : 'Joindre fichier'}
            </Button>
            {attachment && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = '' }}
                disabled={pending}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <Button
            type="button"
            onClick={send}
            disabled={!draft.trim() || pending || selectedAgents.size === 0}
          >
            <Send className="h-3 w-3 mr-1" />
            {pending ? 'Envoi…' : selectedAgents.size > 1 ? `Envoyer aux ${selectedAgents.size} agents` : 'Envoyer'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Ctrl/Cmd + Entrée pour envoyer · Tape <code className="font-mono bg-muted px-1 rounded">/</code> pour les commandes rapides · max {MAX_AGENTS} agents
        </p>
      </div>
    </div>
  )
}
