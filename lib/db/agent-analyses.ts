import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type { DbAgentAnalysis, ChatAgentName, AgentAnalysisStatus } from '@/types/db'

export async function listAgentAnalyses(tenderId: string): Promise<DbAgentAnalysis[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_agent_analyses')
    .select('id, tender_id, agent_name, status, summary, key_points, raw_content, metadata, error_msg, created_at, updated_at')
    .eq('tender_id', tenderId)
  if (error) throw error
  return (data ?? []) as DbAgentAnalysis[]
}

export async function getAgentAnalysis(tenderId: string, agent: ChatAgentName): Promise<DbAgentAnalysis | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_agent_analyses')
    .select('id, tender_id, agent_name, status, summary, key_points, raw_content, metadata, error_msg, created_at, updated_at')
    .eq('tender_id', tenderId)
    .eq('agent_name', agent)
    .maybeSingle()
  if (error || !data) return null
  return data as DbAgentAnalysis
}

export async function upsertAgentAnalysis(input: {
  tender_id: string
  agent_name: ChatAgentName
  status: AgentAnalysisStatus
  summary?: string | null
  key_points?: Record<string, unknown> | null
  raw_content?: string | null
  metadata?: Record<string, unknown> | null
  error_msg?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('tender_agent_analyses')
    .upsert(
      {
        tender_id: input.tender_id,
        agent_name: input.agent_name,
        status: input.status,
        summary: input.summary ?? null,
        key_points: input.key_points ?? null,
        raw_content: input.raw_content ?? null,
        metadata: input.metadata ?? null,
        error_msg: input.error_msg ?? null,
        updated_at: new Date().toISOString(),
        ...(orgId ? { organization_id: orgId } : {}),
      },
      { onConflict: 'tender_id,agent_name' }
    )
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}
