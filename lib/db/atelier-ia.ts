import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbTenderChatMessage, DbTenderChatAttachment, DbTenderConversation, ChatAgentName } from '@/types/db'

export async function listConversations(tenderId: string): Promise<DbTenderConversation[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_conversations')
    .select('id, tender_id, name, position, created_at, updated_at')
    .eq('tender_id', tenderId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data ?? []) as DbTenderConversation[]
}

export async function createConversation(tenderId: string, name: string, position: number): Promise<DbTenderConversation> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_conversations')
    .insert({ tender_id: tenderId, name, position })
    .select('id, tender_id, name, position, created_at, updated_at')
    .single()
  if (error || !data) throw error ?? new Error('No data')
  return data as DbTenderConversation
}

export async function renameConversation(id: string, name: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('tender_conversations')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function listChatMessages(tenderId: string, conversationId?: string | null): Promise<DbTenderChatMessage[]> {
  const supabase = await createServerClient()
  let query = supabase
    .from('tender_chat_messages')
    .select('id, tender_id, conversation_id, user_id, agent_name, role, content, metadata, created_at')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: true })
  if (conversationId !== undefined) {
    query = conversationId === null
      ? query.is('conversation_id', null)
      : query.eq('conversation_id', conversationId)
  }
  const { data, error } = await query
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
  conversation_id?: string | null
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
      conversation_id: input.conversation_id ?? null,
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
