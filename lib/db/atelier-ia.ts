import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbTenderChatMessage, DbTenderChatAttachment, ChatAgentName } from '@/types/db'

export async function listChatMessages(tenderId: string): Promise<DbTenderChatMessage[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_chat_messages')
    .select('id, tender_id, user_id, agent_name, role, content, metadata, created_at')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DbTenderChatMessage[]
}

export async function listChatAttachments(messageIds: string[]): Promise<DbTenderChatAttachment[]> {
  if (messageIds.length === 0) return []
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_chat_attachments')
    .select('id, message_id, storage_path, filename, size_bytes, extracted_text, created_at')
    .in('message_id', messageIds)
  if (error) throw error
  return (data ?? []) as DbTenderChatAttachment[]
}

export async function insertChatMessage(input: {
  tender_id: string
  user_id: string | null
  agent_name: ChatAgentName | null
  role: 'user' | 'agent' | 'system'
  content: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_chat_messages')
    .insert({
      tender_id: input.tender_id,
      user_id: input.user_id,
      agent_name: input.agent_name,
      role: input.role,
      content: input.content,
      metadata: input.metadata ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}

export async function insertChatAttachment(input: {
  message_id: string
  storage_path: string
  filename: string
  size_bytes: number
  extracted_text?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_chat_attachments')
    .insert({
      message_id: input.message_id,
      storage_path: input.storage_path,
      filename: input.filename,
      size_bytes: input.size_bytes,
      extracted_text: input.extracted_text ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}
