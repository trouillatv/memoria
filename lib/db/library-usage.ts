import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'

/**
 * Compte les citations d'items de bibliothèque dans :
 * - tender_chat_messages.metadata.sources[].library_item_id (type='library')
 * - tender_analyses.{constraints,risks,checklist}[*].sources[*].library_item_id
 *
 * Pour MVP : fetch JSON et aggregate côté Node. Pour <10k rows c'est OK.
 * Si volume monte, migrer en RPC SQL.
 */
export async function getLibraryUsageCounts(opts: { sinceDays?: number } = {}): Promise<Map<string, number>> {
  const since = new Date(Date.now() - (opts.sinceDays ?? 30) * 24 * 60 * 60 * 1000).toISOString()
  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return new Map()
  const counts = new Map<string, number>()

  // 1. Chat messages
  let qChat = supabase.from('tender_chat_messages').select('metadata').gte('created_at', since)
  qChat = qChat.in('organization_id', orgIds)
  const { data: chatRows } = await qChat

  for (const row of chatRows ?? []) {
    const meta = row.metadata as Record<string, unknown> | null
    if (!meta) continue
    const sources = meta.sources
    if (!Array.isArray(sources)) continue
    for (const s of sources as Array<Record<string, unknown>>) {
      if (s?.type === 'library' && typeof s?.library_item_id === 'string') {
        counts.set(s.library_item_id, (counts.get(s.library_item_id) ?? 0) + 1)
      }
    }
  }

  // 2. Tender analyses (constraints / risks / checklist)
  let qAnalysis = supabase.from('tender_analyses').select('constraints, risks, checklist').gte('created_at', since)
  qAnalysis = qAnalysis.in('organization_id', orgIds)
  const { data: analysisRows } = await qAnalysis

  for (const row of analysisRows ?? []) {
    for (const fieldName of ['constraints', 'risks', 'checklist'] as const) {
      const arr = (row as Record<string, unknown>)[fieldName]
      if (!Array.isArray(arr)) continue
      for (const item of arr as Array<Record<string, unknown>>) {
        const sources = item?.sources
        if (!Array.isArray(sources)) continue
        for (const s of sources as Array<Record<string, unknown>>) {
          if (s?.type === 'library' && typeof s?.library_item_id === 'string') {
            counts.set(s.library_item_id, (counts.get(s.library_item_id) ?? 0) + 1)
          }
        }
      }
    }
  }

  return counts
}

/**
 * Compte le nombre d'AO ce mois (30j) qui ont injecté la bibliothèque (library_snapshot.items_count > 0).
 */
export async function countTendersUsingLibraryThisMonth(): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_analyses')
    .select('library_snapshot, tender_id')
    .gte('created_at', since)
  if (error) throw error
  const tenderIds = new Set<string>()
  for (const row of data ?? []) {
    const snap = row.library_snapshot as Record<string, unknown> | null
    if (snap && typeof snap.items_count === 'number' && snap.items_count > 0) {
      tenderIds.add(row.tender_id as string)
    }
  }
  return tenderIds.size
}
