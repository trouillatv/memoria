'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Bot, User, Loader2, X, Sparkles, FileSearch, FileText, Swords, Calculator, MapPinned, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { sendChatMessageAction } from './atelier-actions'
import { toast } from 'sonner'
import type { ChatAgentName, DbTenderChatMessage } from '@/types/db'

interface AgentMeta {
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const AGENTS: Record<ChatAgentName, AgentMeta> = {
  general:           { label: 'Général',            description: 'Assistant généraliste, répond à toutes vos questions sur l\'AO',        icon: Sparkles },
  lecteur_ao:        { label: 'Lecteur AO',         description: 'Spécialiste de la lecture critique du cahier des charges',              icon: FileSearch },
  memoire_technique: { label: 'Mémoire technique',  description: 'Reformule, enrichit ou adapte la mémoire technique générée',            icon: FileText },
  contradicteur:     { label: 'Contradicteur',      description: 'Avocat du diable : identifie les faiblesses, anticipe les critiques',  icon: Swords },
  financier:         { label: 'Financier',          description: 'Modélisation des coûts, marges, pénalités et ROI',                      icon: Calculator },
  terrain:           { label: 'Terrain',            description: 'Faisabilité opérationnelle : effectifs, rotations, logistique',         icon: MapPinned },
  conformite:        { label: 'Conformité',         description: 'Normes ISO, RGPD, clauses sociales, certifications métier',             icon: Scale },
}

const AGENT_LABELS: Record<ChatAgentName, string> =
  Object.fromEntries((Object.keys(AGENTS) as ChatAgentName[]).map((k) => [k, AGENTS[k].label])) as Record<ChatAgentName, string>

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
    // Replace the optimistic placeholder by the real user message returned by
    // the action, then append the agent response. No reload → l'onglet actif
    // est preserve.
    if (r && 'userMessage' in r && r.userMessage && r.agentMessage) {
      setMessages((prev) =>
        prev
          .filter((m) => m.id !== optimisticUser.id)
          .concat([r.userMessage as DbTenderChatMessage, r.agentMessage as DbTenderChatMessage])
      )
    }
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
          <div className="space-y-2">
            <Label htmlFor="agent-select" className="text-sm font-medium">Agent IA</Label>
            <div className="flex items-start gap-3 flex-wrap">
              {/*
                Native HTML <select> volontairement utilise ici (au lieu du Select shadcn/base-ui)
                car le composant base-ui v4 a un comportement de positioning instable (le popup
                ne se rend pas comme un vrai overlay flottant et chevauche le contenu suivant).
                Pour le MVP, on prefere une UI fiable a une UI fancy. La perte = les icones
                ne sont pas affichees DANS les options du dropdown (les <option> HTML natives ne
                supportent que du texte), mais l'icone de l'agent SELECTIONNE est tout de meme
                visible juste a cote du select.
              */}
              <div className="flex items-center gap-2 w-full sm:w-72">
                {(() => {
                  const Icon = AGENTS[agent].icon
                  return <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                })()}
                <select
                  id="agent-select"
                  value={agent}
                  onChange={(e) => setAgent(e.target.value as ChatAgentName)}
                  disabled={pending}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {(Object.keys(AGENTS) as ChatAgentName[]).map((k) => (
                    <option key={k} value={k}>{AGENTS[k].label}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground flex-1 min-w-0 pt-2">
                {AGENTS[agent].description}
              </p>
            </div>
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
