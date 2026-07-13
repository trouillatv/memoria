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

export type MemoryHitType =
  | 'anomaly' | 'site_note' | 'intervention' | 'photo'
  // S4a-1 — mémoire récente produite par MemorIA (actions, décisions de CR
  // validées, réserves, PV validés), désormais dans le corpus de recherche.
  | 'site_action' | 'meeting_decision' | 'site_reserve' | 'report_document'
  // Mig 200 — le reste de la mémoire. `observation` est le corpus le plus
  // vivant du produit (note de terrain ou transcription d'un vocal) : il était
  // INVISIBLE à la recherche jusqu'ici.
  | 'observation' | 'site_decision' | 'knowledge' | 'blocage' | 'obligation'
  // Le SUJET lui-même : pas un fait, mais LE FIL auquel les faits se rattachent.
  | 'subject'

export interface MemoryHit {
  type: MemoryHitType
  id: string
  title: string
  snippet: string
  occurredAt: string
  siteId: string | null
  contractId: string | null
  rank: number
  /** Le fil auquel ce fait est rattaché, s'il l'est. C'est lui qui transforme
   *  une liste de résultats en histoire (« on avait déjà vu cette fuite ? »). */
  subjectId: string | null
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
    subject_id: string | null
  }) => ({
    type: row.type,
    id: row.id,
    title: row.title ?? '',
    snippet: row.snippet ?? '',
    occurredAt: row.occurred_at,
    siteId: row.site_id,
    contractId: row.contract_id,
    rank: row.rank,
    subjectId: row.subject_id ?? null,
  }))
}

/**
 * Où mène un résultat.
 *
 * Règle : on emmène TOUJOURS vers le fil s'il existe. Un fait isolé répond
 * « oui, on en a parlé » ; le fil répond « voilà toute l'histoire » — c'est ce
 * que Guillaume cherche vraiment quand il demande « on avait déjà vu ça ? ».
 */
export function memoryHitHref(hit: MemoryHit): string {
  if (!hit.siteId) return '/sites'

  // Le sujet EST le fil.
  if (hit.type === 'subject') return `/sites/${hit.siteId}/subjects/${hit.id}`

  // Un fait rattaché à un sujet : on ouvre le fil, pas le fait isolé.
  if (hit.subjectId) return `/sites/${hit.siteId}/subjects/${hit.subjectId}`

  // Sinon la fiche chantier, qui agrège la mémoire (pas de deep-link par objet).
  return `/sites/${hit.siteId}`
}
