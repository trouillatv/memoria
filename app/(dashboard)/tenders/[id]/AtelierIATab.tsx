'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { Send, Paperclip, Loader2, X, FileDown, RefreshCw, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { sendChatMessageAction, createConversationAction, renameConversationAction } from './atelier-actions'
import { toast } from 'sonner'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { AtelierMessageThread } from './AtelierMessageThread'
import { CopiloteHeroCard } from './CopiloteHeroCard'
import { HeroCompactRibbon } from './HeroCompactRibbon'
import { ModeCard } from './ModeCard'
import { resolveMode, modeCta, MAX_AGENTS } from './copilote-mode'
import { loadSelectedAgents, saveSelectedAgents } from './agent-selection-storage'
import { cn } from '@/lib/utils'
import { pickThinkingPhrase } from './agent-thinking-phrases'
import { SLASH_COMMANDS, type SlashCommand } from './slash-commands'
import type { ChatAgentName, DbTenderChatMessage, DbTenderAnalysis, DbTenderConversation } from '@/types/db'

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

// ---------------------------------------------------------------------------
// AtelierIATab
// ---------------------------------------------------------------------------

interface AtelierIATabProps {
  tenderId: string
  initialMessages: DbTenderChatMessage[]
  initialConversations: DbTenderConversation[]
  tenderAnalysis: DbTenderAnalysis | null
  tenderTitle: string
  agentReadyCount?: number
}

export function AtelierIATab({ tenderId, initialMessages, initialConversations, tenderAnalysis, tenderTitle, agentReadyCount = 0 }: AtelierIATabProps) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()

  // Conversations (onglets nommés)
  const [conversations, setConversations] = useState<DbTenderConversation[]>(initialConversations)
  // null = onglet "général" (messages sans conversation_id)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creatingConv, startCreatingConv] = useTransition()

  // All messages from server; filter client-side by active conversation
  const [allMessages, setAllMessages] = useState<DbTenderChatMessage[]>(initialMessages)
  const messages = activeConversationId === null
    ? allMessages.filter((m) => m.conversation_id === null)
    : allMessages.filter((m) => m.conversation_id === activeConversationId)

  const [selectedAgents, setSelectedAgents] = useState<ChatAgentName[]>([])

  useEffect(() => {
    setSelectedAgents(loadSelectedAgents(tenderId))
  }, [tenderId])

  useEffect(() => {
    saveSelectedAgents(tenderId, selectedAgents)
  }, [tenderId, selectedAgents])

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
      if (prev.includes(agent)) return prev.filter((a) => a !== agent)
      if (prev.length >= MAX_AGENTS) {
        toast.warning(`Max ${MAX_AGENTS} agents simultanés`)
        return prev
      }
      return [...prev, agent]
    })
  }

  function applySlashCommand(cmd: SlashCommand) {
    setDraft(cmd.prompt)
    setSelectedAgents(cmd.agents.slice(0, MAX_AGENTS))
    setSlashSelectedIdx(0)
    setTimeout(() => {
      const ta = document.querySelector('textarea[data-composer]') as HTMLTextAreaElement | null
      ta?.focus()
      if (ta) ta.setSelectionRange(cmd.prompt.length, cmd.prompt.length)
    }, 30)
  }

  async function send() {
    if (!draft.trim() || pending || selectedAgents.length === 0) return

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
      conversation_id: activeConversationId,
      user_id: null,
      agent_name: null,
      role: 'user',
      content: draft,
      metadata: null,
      created_at: new Date().toISOString(),
    }
    setAllMessages((prev) => [...prev, optimisticUser])
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
    fd.set('agent_names', JSON.stringify(selectedAgents))
    fd.set('message', sentDraft)
    if (activeConversationId) fd.set('conversation_id', activeConversationId)
    if (sentAttachment) fd.set('attachment', sentAttachment)

    const r = await sendChatMessageAction(fd)
    setPending(false)
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
      setAllMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id))
      return
    }
    // Replace the optimistic placeholder by the real user message returned by
    // the action, then append the agent responses. No reload → l'onglet actif
    // est préservé.
    if (r && 'userMessage' in r && r.userMessage && r.agentMessages) {
      setAllMessages((prev) =>
        prev
          .filter((m) => m.id !== optimisticUser.id)
          .concat([r.userMessage as DbTenderChatMessage, ...(r.agentMessages as DbTenderChatMessage[])])
      )
    }
  }

  async function handleCreateConversation() {
    const name = `Conversation ${conversations.length + 2}`
    startCreatingConv(async () => {
      const fd = new FormData()
      fd.set('tender_id', tenderId)
      fd.set('name', name)
      fd.set('position', String(conversations.length + 1))
      const r = await createConversationAction(fd)
      if (r && 'error' in r) {
        toast.error(r.error)
      } else if (r && 'conversation' in r) {
        setConversations((prev) => [...prev, r.conversation as DbTenderConversation])
        setActiveConversationId((r.conversation as DbTenderConversation).id)
      }
    })
  }

  async function handleRenameSubmit(id: string) {
    const trimmed = renameValue.trim()
    if (!trimmed) { setRenamingId(null); return }
    const fd = new FormData()
    fd.set('id', id)
    fd.set('name', trimmed)
    const r = await renameConversationAction(fd)
    if (r && 'error' in r) {
      toast.error(r.error)
    } else {
      setConversations((prev) => prev.map((c) => c.id === id ? { ...c, name: trimmed } : c))
    }
    setRenamingId(null)
  }

  const firstAgent = selectedAgents[0]

  function handleHeroPromptClick(prompt: string, agents: ChatAgentName[]) {
    setSelectedAgents(agents.slice(0, MAX_AGENTS))
    setDraft(prompt)
    setTimeout(() => {
      const ta = document.querySelector('textarea[data-composer]') as HTMLTextAreaElement | null
      ta?.focus()
    }, 50)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar : Export + Rafraîchir */}
      <div className="flex items-center justify-end gap-2 mb-2">
        <button
          type="button"
          onClick={() => startRefresh(() => { router.refresh() })}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border bg-card hover:bg-muted/40 text-sm transition-colors disabled:opacity-50"
          title="Rafraîchir l'analyse, la synthèse et le reste"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Rafraîchir
        </button>
        <a
          href={`/tenders/${tenderId}/atelier-export.pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border bg-card hover:bg-muted/40 text-sm transition-colors"
          title="Télécharger le dossier de préparation au format PDF"
        >
          <FileDown className="h-4 w-4" />
          Exporter le dossier
        </a>
      </div>

      {/* Barre d'onglets de conversations */}
      <div className="flex items-center gap-0.5 mb-1 overflow-x-auto scrollbar-hide">
        {/* Onglet général (messages sans conversation_id) */}
        <button
          type="button"
          onClick={() => setActiveConversationId(null)}
          className={cn(
            'shrink-0 px-3 py-1.5 rounded-t-md text-sm border-b-2 transition-colors whitespace-nowrap',
            activeConversationId === null
              ? 'border-brand-600 text-foreground font-medium bg-card'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
          )}
        >
          Général
        </button>
        {conversations.map((conv) => (
          <div key={conv.id} className="relative shrink-0 group">
            {renamingId === conv.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleRenameSubmit(conv.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleRenameSubmit(conv.id) }
                  if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null) }
                }}
                className="px-2 py-1 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring w-32"
                maxLength={80}
              />
            ) : (
              <button
                type="button"
                onClick={() => setActiveConversationId(conv.id)}
                onDoubleClick={() => { setRenamingId(conv.id); setRenameValue(conv.name) }}
                title="Double-clic pour renommer"
                className={cn(
                  'px-3 py-1.5 rounded-t-md text-sm border-b-2 transition-colors whitespace-nowrap',
                  activeConversationId === conv.id
                    ? 'border-brand-600 text-foreground font-medium bg-card'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
                )}
              >
                {conv.name}
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={handleCreateConversation}
          disabled={creatingConv}
          title="Nouvelle conversation"
          className="shrink-0 p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Thread scrollable */}
      <div className="flex-1 overflow-y-auto pb-4 rounded-xl border bg-card p-3">
        {messages.length > 0 && (
          <HeroCompactRibbon onPromptClick={handleHeroPromptClick} />
        )}
        <AtelierMessageThread
          messages={messages}
          tenderId={tenderId}
          pending={pending}
          onChallengeLaunched={(newMessages) => {
            setAllMessages((prev) => [...prev, ...newMessages])
          }}
          emptyState={
            <CopiloteHeroCard
              tenderTitle={tenderTitle}
              analysis={tenderAnalysis}
              agentReadyCount={agentReadyCount}
              onPromptClick={handleHeroPromptClick}
            />
          }
        />
        {pending && selectedAgents.length > 0 && (
          <div className="space-y-1.5 mt-3 px-1">
            {selectedAgents.map((agentName) => {
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
        <ModeCard agents={selectedAgents} onChange={setSelectedAgents} />

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
              selectedAgents.length === 0
                ? "Choisissez d'abord un ou plusieurs experts ci-dessous…"
                : selectedAgents.length === 1 && firstAgent
                  ? `Demandez un avis à ${AGENTS[firstAgent].label}…`
                  : `Posez une question à confronter entre ${selectedAgents.length} experts…`
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
            disabled={!draft.trim() || pending || selectedAgents.length === 0}
          >
            <Send className="h-3 w-3 mr-1" />
            {pending ? 'Envoi…' : modeCta(resolveMode(selectedAgents))}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Ctrl/Cmd + Entrée pour envoyer · Tape <code className="font-mono bg-muted px-1 rounded">/</code> pour les commandes rapides · max {MAX_AGENTS} experts
        </p>
      </div>
    </div>
  )
}
