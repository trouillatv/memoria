import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import type { DbActivityLog } from '@/types/db'

export interface ActivityLogQuery {
  entityType?: string
  action?: string
  userId?: string
  limit?: number
  offset?: number
}

export async function listActivityLogs(query: ActivityLogQuery = {}): Promise<DbActivityLog[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('activity_logs')
    .select('id, user_id, entity_type, entity_id, action, metadata, created_at')
    .order('created_at', { ascending: false })

  if (query.entityType) q = q.eq('entity_type', query.entityType)
  if (query.action)     q = q.eq('action', query.action)
  if (query.userId)     q = q.eq('user_id', query.userId)
  q = q.range(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50) - 1)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DbActivityLog[]
}

export async function insertActivityLog(input: {
  userId: string | null
  entityType: string
  entityId: string | null
  action: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('activity_logs')
    .insert({
      user_id:     input.userId,
      entity_type: input.entityType,
      entity_id:   input.entityId,
      action:      input.action,
      metadata:    input.metadata ?? {},
    })
  if (error) throw error
}
