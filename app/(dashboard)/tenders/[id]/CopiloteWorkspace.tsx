'use client'

import { useState, useEffect } from 'react'
import { AgentPanel } from './AgentPanel'
import { AtelierIATab } from './AtelierIATab'
import { AgentAnalysisDrawer } from './AgentAnalysisDrawer'
import type { ChatAgentName, DbAgentAnalysis, DbTenderAnalysis, DbTenderChatMessage } from '@/types/db'

interface CopiloteWorkspaceProps {
  tenderId: string
  initialMessages: DbTenderChatMessage[]
  initialAgentAnalyses: DbAgentAnalysis[]
  tenderAnalysis: DbTenderAnalysis | null
  tenderTitle: string
}

function loadRailExpanded(tenderId: string): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(`copilote-rail-expanded-${tenderId}`) === 'true'
}

function saveRailExpanded(tenderId: string, expanded: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(`copilote-rail-expanded-${tenderId}`, String(expanded))
}

export function CopiloteWorkspace({
  tenderId,
  initialMessages,
  initialAgentAnalyses,
  tenderAnalysis,
  tenderTitle,
}: CopiloteWorkspaceProps) {
  const [viewingAgent, setViewingAgent] = useState<ChatAgentName | null>(null)
  const [railExpanded, setRailExpanded] = useState<boolean>(false)

  useEffect(() => {
    setRailExpanded(loadRailExpanded(tenderId))
  }, [tenderId])

  useEffect(() => {
    saveRailExpanded(tenderId, railExpanded)
  }, [tenderId, railExpanded])

  const viewingAnalysis = viewingAgent
    ? initialAgentAnalyses.find((a) => a.agent_name === viewingAgent) ?? null
    : null

  return (
    <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 h-full">
      <AgentPanel
        tenderId={tenderId}
        analyses={initialAgentAnalyses}
        onView={(agent) => setViewingAgent(agent)}
        expanded={railExpanded}
        onToggleExpanded={() => setRailExpanded((v) => !v)}
      />
      <AtelierIATab
        tenderId={tenderId}
        initialMessages={initialMessages}
        tenderAnalysis={tenderAnalysis}
        tenderTitle={tenderTitle}
      />
      <AgentAnalysisDrawer
        open={viewingAgent !== null}
        analysis={viewingAnalysis}
        tenderId={tenderId}
        onOpenChange={(open) => { if (!open) setViewingAgent(null) }}
      />
    </div>
  )
}
