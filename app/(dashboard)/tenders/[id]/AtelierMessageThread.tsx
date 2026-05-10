'use client'

import { useState } from 'react'
import { Bot, User, Swords, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { runChallengeRoundAction } from './atelier-actions'
import { toast } from 'sonner'
import { AGENT_LABELS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { cn } from '@/lib/utils'
import type { DbTenderChatMessage, ChatAgentName, Source } from '@/types/db'
import { SourceList } from './SourceList'

interface Props {
  messages: DbTenderChatMessage[]
  tenderId: string
  pending?: boolean
  onChallengeLaunched?: (newMessages: DbTenderChatMessage[]) => void
  emptyState?: React.ReactNode
}

interface TurnGroup {
  turnId: string | null
  userMessage: DbTenderChatMessage | null
  rounds: Map<number, DbTenderChatMessage[]>  // challenge_round -> messages
}

function groupMessagesByTurn(messages: DbTenderChatMessage[]): TurnGroup[] {
  const groups = new Map<string, TurnGroup>()
  const orphans: DbTenderChatMessage[] = []  // messages sans turn_id

  for (const m of messages) {
    const turnId = m.metadata && typeof m.metadata === 'object'
      ? (m.metadata as Record<string, unknown>).turn_id as string | undefined
      : undefined
    if (!turnId) {
      orphans.push(m)
      continue
    }
    if (!groups.has(turnId)) {
      groups.set(turnId, { turnId, userMessage: null, rounds: new Map() })
    }
    const g = groups.get(turnId)!
    if (m.role === 'user') {
      g.userMessage = m
    } else if (m.role === 'agent') {
      const round = (m.metadata as Record<string, unknown>).challenge_round as number ?? 0
      if (!g.rounds.has(round)) g.rounds.set(round, [])
      g.rounds.get(round)!.push(m)
    }
  }

  const result: TurnGroup[] = []
  if (orphans.length > 0) {
    // Render legacy messages as a single "implicit turn" without challenge
    const legacyGroup: TurnGroup = { turnId: null, userMessage: null, rounds: new Map([[0, []]]) }
    for (const m of orphans) {
      if (m.role === 'user' && !legacyGroup.userMessage) legacyGroup.userMessage = m
      else if (m.role === 'agent') legacyGroup.rounds.get(0)!.push(m)
    }
    result.push(legacyGroup)
  }
  result.push(...Array.from(groups.values()))
  return result
}

function MessageBubble({ message }: { message: DbTenderChatMessage }) {
  const isUser = message.role === 'user'
  const sources = (message.metadata && typeof message.metadata === 'object'
    ? (message.metadata as Record<string, unknown>).sources
    : undefined) as Source[] | undefined

  if (isUser) {
    return (
      <div className="flex gap-2 flex-row-reverse">
        <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-brand-600 text-white">
          <User className="h-3 w-3" />
        </div>
        <div className="flex-1 text-right">
          <div className="inline-block rounded-lg px-3 py-2 text-sm whitespace-pre-wrap bg-brand-600 text-white">
            {message.content}
          </div>
        </div>
      </div>
    )
  }

  // Agent bubble with color identity
  const agentName = message.agent_name as ChatAgentName | null
  const color = agentName ? AGENT_COLORS[agentName] : AGENT_COLORS.general
  const agentLabel = agentName
    ? (AGENT_LABELS[agentName] ?? agentName)
    : 'Agent'

  return (
    <div className="flex gap-2">
      <div className={cn('shrink-0 w-7 h-7 rounded-full flex items-center justify-center', color.bgClass)}>
        <Bot className={cn('h-3 w-3', color.textClass)} />
      </div>
      <div className="flex-1">
        <Badge
          className={cn('text-xs mb-1 border', color.bgClass, color.textClass, color.borderClass)}
        >
          {agentLabel}
        </Badge>
        <div className={cn('rounded-lg px-3 py-2 text-sm whitespace-pre-wrap bg-card border-l-4', color.borderClass)}>
          {message.content}
        </div>
        {sources && sources.length > 0 && (
          <div className="mt-2">
            <SourceList sources={sources} />
          </div>
        )}
      </div>
    </div>
  )
}

export function AtelierMessageThread({ messages, tenderId, pending = false, onChallengeLaunched, emptyState }: Props) {
  const [challengingTurnId, setChallengingTurnId] = useState<string | null>(null)

  if (messages.length === 0) {
    return emptyState ?? (
      <p className="text-sm text-muted-foreground text-center py-8">
        Aucun message pour le moment.
      </p>
    )
  }

  const groups = groupMessagesByTurn(messages)

  async function launchChallenge(turnId: string, currentRound: number) {
    if (challengingTurnId) return
    setChallengingTurnId(turnId)
    const fd = new FormData()
    fd.set('tender_id', tenderId)
    fd.set('turn_id', turnId)
    fd.set('current_round', String(currentRound))
    const r = await runChallengeRoundAction(fd)
    setChallengingTurnId(null)
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
      return
    }
    if (r && 'agentMessages' in r && r.agentMessages) {
      toast.success(`Challenge round ${currentRound + 1} terminé`)
      onChallengeLaunched?.(r.agentMessages as DbTenderChatMessage[])
    }
  }

  return (
    <div className="space-y-6">
      {groups.map((group, idx) => {
        const sortedRounds = Array.from(group.rounds.entries()).sort(([a], [b]) => a - b)
        const lastRound = sortedRounds.length > 0 ? sortedRounds[sortedRounds.length - 1][0] : 0
        const lastRoundMessages = sortedRounds.length > 0 ? sortedRounds[sortedRounds.length - 1][1] : []
        const canChallenge =
          group.turnId !== null
          && lastRoundMessages.length >= 2
          && lastRound < 2
          && !challengingTurnId
          && !pending
        const isChallengingThis = challengingTurnId === group.turnId

        return (
          <div key={group.turnId ?? `legacy-${idx}`} className="space-y-3">
            {group.userMessage && <MessageBubble message={group.userMessage} />}

            {sortedRounds.map(([roundNum, roundMessages]) => (
              <div key={roundNum} className="space-y-2">
                {roundNum > 0 && (
                  <div className="flex items-center gap-2 my-3">
                    <div className="flex-1 h-px bg-border" />
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                      Challenge round {roundNum}
                    </Badge>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                <div className={`grid gap-2 ${roundMessages.length === 1 ? 'grid-cols-1' : roundMessages.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
                  {roundMessages.map((m) => (
                    <div key={m.id} className="border rounded-lg p-2 bg-card">
                      <MessageBubble message={m} />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {(canChallenge || isChallengingThis) && group.turnId && (
              <div className="flex flex-col items-center gap-1 pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => launchChallenge(group.turnId!, lastRound)}
                  disabled={isChallengingThis || pending}
                  className="bg-gradient-to-br from-amber-50 to-blue-50 border-amber-200 hover:from-amber-100 hover:to-blue-100"
                >
                  {isChallengingThis ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Les agents se confrontent…</>
                  ) : (
                    <><Swords className="h-3 w-3 mr-1" />Confronter les perspectives</>
                  )}
                </Button>
                {!isChallengingThis && (
                  <p className="text-[10px] text-muted-foreground">
                    Round {lastRound + 1} · {lastRoundMessages.length} agents réagiront aux réponses des autres
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
