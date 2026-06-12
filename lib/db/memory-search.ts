// Phase 2.2 — Recherche full-text transversale dans la mémoire.
//
// Wrapper TypeScript de la RPC search_memory (migration 044). Interroge
// anomalies, notes de sites, notes d'intervention et captions de photos
// indexées en tsvector (migration 043).
//
// Doctrine V5 : la mémoire devient utile au lieu d'être un dépotoir. La
// recherche ne traverse jamais de données per-personne — uniquement faits,
// lieux, événements.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

export type MemoryHitType = 'anomaly' | 'site_note' | 'intervention' | 'photo'

export interface MemoryHit {
  type: MemoryHitType
  id: string
  title: string
  snippet: string
  occurredAt: string
  siteId: string | null
  contractId: string | null
  rank: number
}

export interface SearchMemoryOptions {
  q: string
  contractId?: string | null
  siteId?: string | null
  periodDays?: number
  limit?: number
}

export async function searchMemory(opts: SearchMemoryOptions): Promise<MemoryHit[]> {
  const q = opts.q.trim()
  if (q.length < 2) return []

  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const { data, error } = await supabase.rpc('search_memory', {
    p_q: q,
    p_contract_id: opts.contractId ?? null,
    p_site_id: opts.siteId ?? null,
    p_period_days: opts.periodDays ?? 365,
    p_limit: opts.limit ?? 50,
    p_org_id: orgId ?? null,
  })

  if (error) {
    console.error('[searchMemory]', error)
    return []
  }

  return (data ?? []).map((row: {
    type: MemoryHitType
    id: string
    title: string | null
    snippet: string | null
    occurred_at: string
    site_id: string | null
    contract_id: string | null
    rank: number
  }) => ({
    type: row.type,
    id: row.id,
    title: row.title ?? '',
    snippet: row.snippet ?? '',
    occurredAt: row.occurred_at,
    siteId: row.site_id,
    contractId: row.contract_id,
    rank: row.rank,
  }))
}

export function memoryHitHref(hit: MemoryHit): string {
  switch (hit.type) {
    case 'anomaly':
    case 'photo':
    case 'intervention':
      // Pas d'URL directe à l'anomalie/photo : on renvoie vers la preuve ou
      // l'intervention parent quand on l'aura. Pour l'instant on tape la
      // page site qui agrégera tout.
      return hit.siteId ? `/sites/${hit.siteId}` : '/sites'
    case 'site_note':
      return hit.siteId ? `/sites/${hit.siteId}` : '/sites'
    default:
      return '/'
  }
}
