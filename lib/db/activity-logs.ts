import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/db/users'
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

/**
 * Santé du journal d'audit (pour /admin/monitoring) : volume sur 24h et date
 * du dernier événement. Si 0 sur un système actif, l'audit ne s'écrit plus.
 * Admin client (les logs ne sont pas lisibles en RLS par tous).
 */
export async function getAuditActivitySummary(): Promise<{ count24h: number; lastAt: string | null }> {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [{ count }, { data: last }] = await Promise.all([
    supabase.from('activity_logs').select('*', { count: 'exact', head: true }).gte('created_at', since),
    supabase.from('activity_logs').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  return { count24h: count ?? 0, lastAt: (last as { created_at?: string } | null)?.created_at ?? null }
}

/**
 * Transparence (board 2026-05-26) : combien de fois la fiche d'une personne a
 * été consultée, AGRÉGÉ PAR RÔLE du consultant — jamais nominatif. Permet
 * d'afficher à la personne « vous avez été consulté(e) » sur /account.
 * Admin client + scope strict entity_id = ce user.
 */
export async function getProfileConsultationSummary(userId: string): Promise<{
  total: number
  byRole: Record<string, number>
  lastAt: string | null
}> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('activity_logs')
    .select('metadata, created_at')
    .eq('entity_type', 'user')
    .eq('entity_id', userId)
    .eq('action', 'opened')
    .order('created_at', { ascending: false })
    .limit(500)
  const rows = (data ?? []) as Array<{ metadata: Record<string, unknown> | null; created_at: string }>
  const consultations = rows.filter((r) => r.metadata?.kind === 'intervenants_page_consulted')
  const byRole: Record<string, number> = {}
  for (const r of consultations) {
    const role = String(r.metadata?.viewer_role ?? 'inconnu')
    byRole[role] = (byRole[role] ?? 0) + 1
  }
  return {
    total: consultations.length,
    byRole,
    lastAt: consultations[0]?.created_at ?? null,
  }
}

export async function insertActivityLog(input: {
  userId: string | null
  entityType: string
  entityId: string | null
  action: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const { error } = await supabase
    .from('activity_logs')
    .insert({
      user_id:     input.userId,
      entity_type: input.entityType,
      entity_id:   input.entityId,
      action:      input.action,
      metadata:    input.metadata ?? {},
      ...(orgId ? { organization_id: orgId } : {}),
    })
  if (error) throw error
}
