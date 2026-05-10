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
import { cn } from '@/lib/utils'
import type { ChatAgentName, DbTenderChatMessage, DbAgentAnalysis, AgentAnalysisStatus } from '@/types/db'

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
          title={effectiveStatus === 'failed' ? 'Réessayer l\'analyse de cet agent' : 'Lancer l\'analyse de cet agent'}
        >
          {effectiveStatus === 'failed' ? 'Réessayer' : 'Analyser'}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AtelierIATab
// ---------------------------------------------------------------------------

export function AtelierIATab({ tenderId, initialMessages, initialAgentAnalyses }: {
  tenderId: string
  initialMessages: DbTenderChatMessage[]
  initialAgentAnalyses: DbAgentAnalysis[]
}) {
  const [messages, setMessages] = useState<DbTenderChatMessage[]>(initialMessages)
  const [selectedAgents, setSelectedAgents] = useState<Set<ChatAgentName>>(() => new Set<ChatAgentName>(['general']))
  const [agentAnalyses, setAgentAnalyses] = useState<Map<ChatAgentName, DbAgentAnalysis>>(
    () => new Map(initialAgentAnalyses.map(a => [a.agent_name, a]))
  )
  const [analyzingAgents, setAnalyzingAgents] = useState<Set<ChatAgentName>>(new Set())
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

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
        />
        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{selectedAgents.size === 1 ? 'Agent réfléchit' : `${selectedAgents.size} agents réfléchissent`}&hellip;</span>
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

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); autoGrow(e.currentTarget) }}
          placeholder={
            selectedAgents.size === 0
              ? 'Sélectionne au moins 1 agent…'
              : selectedAgents.size === 1 && firstAgent
                ? `Pose ta question à l'agent ${AGENTS[firstAgent].label}…`
                : `Pose ta question aux ${selectedAgents.size} agents sélectionnés…`
          }
          rows={2}
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              send()
            }
          }}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 mb-2"
          style={{ minHeight: '60px', maxHeight: '200px', overflow: 'hidden' }}
        />

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
          Ctrl/Cmd + Entrée pour envoyer · max {MAX_AGENTS} agents · 5 MB pour la pièce jointe
        </p>
      </div>
    </div>
  )
}
