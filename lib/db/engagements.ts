import { createAdminClient } from '@/lib/supabase/admin'
import type {
  DbEngagement,
  EngagementCategory,
  EngagementSourceType,
  EngagementStatus,
} from '@/types/db'

export async function listEngagementsByTender(tenderId: string): Promise<DbEngagement[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .select('*')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listEngagementsByContract(contractId: string): Promise<DbEngagement[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .select('*')
    .eq('contract_id', contractId)
    .in('status', ['active', 'completed'])
    .order('category')
  if (error) throw error
  return data ?? []
}

export async function listAllEngagements(): Promise<DbEngagement[]> {
  // Used by debug page only
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data ?? []
}

/** Counts active+completed engagements per contract — single query, no N+1. */
export async function countEngagementsByContracts(
  contractIds: string[]
): Promise<Map<string, number>> {
  if (contractIds.length === 0) return new Map()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .select('contract_id')
    .in('contract_id', contractIds)
    .in('status', ['active', 'completed'])
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    if (!row.contract_id) continue
    counts.set(row.contract_id, (counts.get(row.contract_id) ?? 0) + 1)
  }
  return counts
}

export async function bulkInsertEngagements(input: {
  tender_id: string
  created_by: string | null
  engagements: Array<{
    source_type: EngagementSourceType
    source_excerpt: string
    source_ref: Record<string, unknown> | null
    category: EngagementCategory
    short_label: string
    measurable: boolean
    ai_confidence: number | null
  }>
}): Promise<DbEngagement[]> {
  if (input.engagements.length === 0) return []
  const supabase = createAdminClient()
  const rows = input.engagements.map((e) => ({
    tender_id: input.tender_id,
    created_by: input.created_by,
    status: 'extracted' as EngagementStatus,
    source_type: e.source_type,
    source_excerpt: e.source_excerpt,
    source_ref: e.source_ref,
    category: e.category,
    short_label: e.short_label,
    measurable: e.measurable,
    ai_confidence: e.ai_confidence,
  }))
  const { data, error } = await supabase.from('engagements').insert(rows).select('*')
  if (error) throw error
  return data ?? []
}

export async function curateEngagement(
  id: string,
  patch: { short_label?: string; category?: EngagementCategory; measurable?: boolean }
): Promise<void> {
  const supabase = createAdminClient()
  const updates: Record<string, unknown> = { status: 'curated' as EngagementStatus }
  if (patch.short_label !== undefined) updates.short_label = patch.short_label
  if (patch.category !== undefined) updates.category = patch.category
  if (patch.measurable !== undefined) updates.measurable = patch.measurable
  const { error } = await supabase
    .from('engagements')
    .update(updates)
    .eq('id', id)
    .eq('status', 'extracted')
  if (error) throw error
}

export async function rejectEngagements(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('engagements')
    .delete()
    .in('id', ids)
    .eq('status', 'extracted')
  if (error) throw error
}

export async function activateEngagementsForContract(
  tenderId: string,
  contractId: string
): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .update({ contract_id: contractId, status: 'active' as EngagementStatus })
    .eq('tender_id', tenderId)
    .in('status', ['extracted', 'curated'])
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

export async function archiveEngagement(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('engagements')
    .update({ status: 'archived' as EngagementStatus })
    .eq('id', id)
  if (error) throw error
}
