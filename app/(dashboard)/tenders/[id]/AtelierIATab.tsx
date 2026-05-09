'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Bot, User, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { sendChatMessageAction } from './atelier-actions'
import { toast } from 'sonner'
import type { ChatAgentName, DbTenderChatMessage } from '@/types/db'

const AGENT_LABELS: Record<ChatAgentName, string> = {
  general: 'Général',
  lecteur_ao: 'Lecteur AO',
  memoire_technique: 'Mémoire technique',
  contradicteur: 'Contradicteur',
  financier: 'Financier',
  terrain: 'Terrain',
  conformite: 'Conformité',
}

export function AtelierIATab({ tenderId, initialMessages }: { tenderId: string; initialMessages: DbTenderChatMessage[] }) {
  const [messages, setMessages] = useState<DbTenderChatMessage[]>(initialMessages)
  const [agent, setAgent] = useState<ChatAgentName>('general')
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function send() {
    if (!draft.trim() || pending) return
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
    fd.set('agent_name', agent)
    fd.set('message', sentDraft)
    if (sentAttachment) fd.set('attachment', sentAttachment)

    const r = await sendChatMessageAction(fd)
    setPending(false)
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id))
      return
    }
    // Server-side revalidation will refresh; as a quick UX win, we could refetch.
    // Simplest : reload via router.refresh()
    window.location.reload()
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-3 max-h-[60vh] overflow-y-auto space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Aucun message pour le moment. Pose une question à un agent IA pour démarrer la conversation.
          </p>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Agent {AGENT_LABELS[agent]} réfléchit&hellip;</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Agent :</span>
            <Select value={agent} onValueChange={(v) => setAgent(v as ChatAgentName)}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(AGENT_LABELS) as ChatAgentName[]).map((k) => (
                  <SelectItem key={k} value={k}>{AGENT_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Pose ta question à l'agent ${AGENT_LABELS[agent]}…`}
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
            <Button type="button" onClick={send} disabled={!draft.trim() || pending}>
              <Send className="h-3 w-3 mr-1" />
              {pending ? 'Envoi…' : 'Envoyer'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Ctrl/Cmd + Entrée pour envoyer · max 5 MB pour la pièce jointe
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function MessageBubble({ message }: { message: DbTenderChatMessage }) {
  const isUser = message.role === 'user'
  const Icon = isUser ? User : Bot
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${isUser ? 'bg-brand-600 text-white' : 'bg-muted'}`}>
        <Icon className="h-3 w-3" />
      </div>
      <div className={`flex-1 ${isUser ? 'text-right' : ''}`}>
        {!isUser && message.agent_name && (
          <Badge variant="outline" className="text-xs mb-1">{AGENT_LABELS[message.agent_name as ChatAgentName] ?? message.agent_name}</Badge>
        )}
        <div className={`inline-block rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${isUser ? 'bg-brand-600 text-white' : 'bg-muted'}`}>
          {message.content}
        </div>
      </div>
    </div>
  )
}
