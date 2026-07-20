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
  // Mig 215 — l'échéance confirmée. « Quelles échéances ? » n'atteignait aucune
  // table : l'objet existait, la recherche ne le connaissait pas.
  | 'site_deadline'
  // Le SUJET lui-même : pas un fait, mais LE FIL auquel les faits se rattachent.
  | 'subject'
  // Mig 204 — le texte extrait des DOCUMENTS. Les LITIGES en sont exclus, à la
  // source (index partiel + filtre SQL) : jamais dans l'écran seulement.
  | 'document'

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

// La règle de destination vit dans `lib/memory/hit-href.ts` : ce module-ci
// importe le client admin (clé service role) et ne doit jamais atteindre un
// bundle client, or l'overlay ⌘K est un composant client. Réexporté ici pour
// que les appelants existants ne changent pas d'import.
export { memoryHitHref } from '@/lib/memory/hit-href'
