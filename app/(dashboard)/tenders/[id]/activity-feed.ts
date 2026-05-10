import type { ChatAgentName, DbTenderChatMessage, DbAgentAnalysis } from '@/types/db'

export interface ActivityItem {
  id: string
  agentName: ChatAgentName | null
  description: string
  timestamp: string
}

export function buildActivityFeed({
  chatMessages,
  agentAnalyses,
  mainAnalysisCreatedAt,
}: {
  chatMessages: DbTenderChatMessage[]
  agentAnalyses: DbAgentAnalysis[]
  mainAnalysisCreatedAt: string | null
}): ActivityItem[] {
  const items: ActivityItem[] = []

  // Analyses agent ready/failed
  for (const a of agentAnalyses) {
    if (a.status === 'ready') {
      const risksCount = (a.key_points && typeof a.key_points === 'object'
        && Array.isArray((a.key_points as Record<string, unknown>).risks))
        ? ((a.key_points as Record<string, unknown>).risks as unknown[]).length
        : 0
      const blockersCount = (a.key_points && typeof a.key_points === 'object'
        && Array.isArray((a.key_points as Record<string, unknown>).blockers))
        ? ((a.key_points as Record<string, unknown>).blockers as unknown[]).length
        : 0
      let desc = 'a livré son analyse'
      if (blockersCount > 0) desc = `a flaggé ${blockersCount} blocker${blockersCount > 1 ? 's' : ''}`
      else if (risksCount > 0) desc = `a soulevé ${risksCount} risque${risksCount > 1 ? 's' : ''}`
      items.push({
        id: `analysis-${a.id}`,
        agentName: a.agent_name,
        description: desc,
        timestamp: a.updated_at,
      })
    }
  }

  // Messages agent (réponses)
  // On ne liste que la dernière réponse par agent par turn pour ne pas spammer
  const agentMessages = chatMessages.filter((m) => m.role === 'agent')
  for (const m of agentMessages) {
    if (!m.agent_name) continue
    const round = (m.metadata && typeof m.metadata === 'object'
      ? (m.metadata as Record<string, unknown>).challenge_round
      : 0) as number
    items.push({
      id: `msg-${m.id}`,
      agentName: m.agent_name as ChatAgentName,
      description: round > 0 ? `a contesté en challenge round ${round}` : 'a répondu',
      timestamp: m.created_at,
    })
  }

  // Analyse principale du tender
  if (mainAnalysisCreatedAt) {
    items.push({
      id: 'main-analysis',
      agentName: null,
      description: "Analyse complète de l'AO",
      timestamp: mainAnalysisCreatedAt,
    })
  }

  // Sort DESC par timestamp
  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  // Top 5
  return items.slice(0, 5)
}
