// lib/db/watchlist-dismissed.ts
// Accès données de la mémoire du verdict « ne plus suivre » (Plan de visite, Lot B).
//
// Une seule lecture, aucune écriture : les clés de source déjà déclarées
// `dismissed_permanently`, tous chantiers/motifs confondus — l'exclusion est
// définitive, contrairement à la mémoire `not_applicable` (motif + fraîcheur).

import { createAdminClient } from '@/lib/supabase/admin'
import { watchlistSourceKey } from '@/lib/visits/watchlist-not-applicable-memory'

/** Clés (source_kind|source_ref) déjà déclarées « ne plus suivre » sur ce chantier. */
export async function loadDismissedPermanentlyKeys(siteId: string): Promise<Set<string>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_watchlist_item')
    .select('source_kind, source_ref')
    .eq('site_id', siteId)
    .eq('state', 'dismissed_permanently')
    .not('source_ref', 'is', null)
  if (error) throw error
  return new Set(
    (data ?? []).map((r) => watchlistSourceKey(r.source_kind as string, r.source_ref as string)),
  )
}
