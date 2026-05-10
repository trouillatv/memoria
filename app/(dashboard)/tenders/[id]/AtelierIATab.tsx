'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { sendChatMessageAction } from './atelier-actions'
import { toast } from 'sonner'
import { AGENTS } from './agents-metadata'
import { AtelierMessageThread } from './AtelierMessageThread'
import type { ChatAgentName, DbTenderChatMessage } from '@/types/db'

const MAX_AGENTS = 3

export function AtelierIATab({ tenderId, initialMessages }: { tenderId: string; initialMessages: DbTenderChatMessage[] }) {
  const [messages, setMessages] = useState<DbTenderChatMessage[]>(initialMessages)
  const [selectedAgents, setSelectedAgents] = useState<Set<ChatAgentName>>(() => new Set<ChatAgentName>(['general']))
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
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
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-3 max-h-[60vh] overflow-y-auto">
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

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Label className="text-sm font-medium">Agents IA</Label>
              <span className="text-xs text-muted-foreground">
                {selectedAgents.size}/{MAX_AGENTS} sélectionnés
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {(Object.keys(AGENTS) as ChatAgentName[]).map((agent) => {
                const meta = AGENTS[agent]
                const Icon = meta.icon
                const checked = selectedAgents.has(agent)
                const wouldExceed = !checked && selectedAgents.size >= MAX_AGENTS
                return (
                  <label
                    key={agent}
                    className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer text-sm transition-colors ${
                      checked
                        ? 'bg-accent border-brand-600 text-accent-foreground'
                        : wouldExceed
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-muted/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="shrink-0"
                      checked={checked}
                      disabled={wouldExceed || pending}
                      onChange={() => toggleAgent(agent)}
                    />
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{meta.label}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              selectedAgents.size === 0
                ? 'Sélectionne au moins 1 agent…'
                : selectedAgents.size === 1 && firstAgent
                  ? `Pose ta question à l'agent ${AGENTS[firstAgent].label}…`
                  : `Pose ta question aux ${selectedAgents.size} agents sélectionnés…`
            }
            rows={3}
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                send()
              }
            }}
          />
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
          <p className="text-xs text-muted-foreground">
            Ctrl/Cmd + Entrée pour envoyer · max {MAX_AGENTS} agents · 5 MB pour la pièce jointe
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
