'use client'

import { useState } from 'react'
import { AgentPanel } from './AgentPanel'
import { AtelierIATab } from './AtelierIATab'
import type { ChatAgentName, DbAgentAnalysis, DbTenderAnalysis, DbTenderChatMessage } from '@/types/db'

interface CopiloteWorkspaceProps {
  tenderId: string
  initialMessages: DbTenderChatMessage[]
  initialAgentAnalyses: DbAgentAnalysis[]
  tenderAnalysis: DbTenderAnalysis | null
  tenderTitle: string
}

export function CopiloteWorkspace({
  tenderId,
  initialMessages,
  initialAgentAnalyses,
  tenderAnalysis,
  tenderTitle,
}: CopiloteWorkspaceProps) {
  const [, setViewingAgent] = useState<ChatAgentName | null>(null)

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 h-full">
      <AgentPanel
        tenderId={tenderId}
        analyses={initialAgentAnalyses}
        onView={(agent) => setViewingAgent(agent)}
      />
      <AtelierIATab
        tenderId={tenderId}
        initialMessages={initialMessages}
        tenderAnalysis={tenderAnalysis}
        tenderTitle={tenderTitle}
      />
      {/* AgentAnalysisDrawer wired in Task 6 */}
    </div>
  )
}
