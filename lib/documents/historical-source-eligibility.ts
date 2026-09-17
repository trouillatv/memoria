import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

// P0 — DELETED HISTORICAL SOURCE (2026-09-17).
//
// Doctrine unique, partagée par tout consommateur d'un site_report/run/proposal
// historique : une source active = le document source existe ET
// documents.deleted_at IS NULL. Un document supprimé reste conservé en base
// (trace technique/audit) mais devient inéligible à toute projection métier et
// à tout traitement futur — jamais compté dans un PV, jamais repris par le
// sweep, jamais réconcilié, jamais posé en occurrence, jamais rattaché à un
// CBO, jamais écrit par Live Writer.
//
// Piège déjà observé dans ce dépôt : filtrer `.is('deleted_at', null)` sur
// site_reports lui-même ne protège de RIEN — cette colonne existe sur
// site_reports mais n'est quasi jamais renseignée (un rapport n'est pas
// supprimé quand son document source l'est). La seule colonne qui compte ici
// est `documents.deleted_at`, atteinte via `site_reports.source_document_id`
// ou `document_extraction_run.document_id`.

/** Résout l'ensemble des document_id supprimés parmi ceux fournis. Une seule
 *  requête, à utiliser pour filtrer une LISTE de rapports/runs déjà en main. */
export async function getDeletedDocumentIds(
  supabase: SupabaseClient,
  documentIds: Array<string | null | undefined>,
): Promise<Set<string>> {
  const ids = [...new Set(documentIds.filter((id): id is string => !!id))]
  if (ids.length === 0) return new Set()
  const { data } = await supabase
    .from('documents')
    .select('id')
    .in('id', ids)
    .not('deleted_at', 'is', null)
  return new Set((data ?? []).map((r) => (r as { id: string }).id))
}

/** Vérifie un document source unique — à utiliser pour une décision ponctuelle
 *  (ex. porte d'entrée d'un pipeline sur un seul rapport). */
export async function isSourceDocumentDeleted(
  supabase: SupabaseClient,
  documentId: string | null | undefined,
): Promise<boolean> {
  if (!documentId) return false
  const { data } = await supabase
    .from('documents')
    .select('deleted_at')
    .eq('id', documentId)
    .maybeSingle()
  return Boolean((data as { deleted_at: string | null } | null)?.deleted_at)
}

/** Même vérification, à partir d'un extraction_run_id (résout document_id
 *  puis délègue à isSourceDocumentDeleted). Un run sans document_id associé
 *  (visite terrain, jamais un import) est toujours éligible. */
export async function isExtractionRunSourceDeleted(
  supabase: SupabaseClient,
  extractionRunId: string | null | undefined,
): Promise<boolean> {
  if (!extractionRunId) return false
  const { data } = await supabase
    .from('document_extraction_run')
    .select('document_id')
    .eq('id', extractionRunId)
    .maybeSingle()
  const documentId = (data as { document_id: string | null } | null)?.document_id
  return isSourceDocumentDeleted(supabase, documentId)
}

/** Filtre une liste de lignes portant `source_document_id` : ne garde que
 *  celles dont le document source n'est pas supprimé (ou n'a pas de document,
 *  ex. visite terrain). Pratique pour site-timeline/repository/memory-build. */
export async function filterEligibleBySourceDocument<T extends { source_document_id: string | null }>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<T[]> {
  const deleted = await getDeletedDocumentIds(supabase, rows.map((r) => r.source_document_id))
  if (deleted.size === 0) return rows
  return rows.filter((r) => !r.source_document_id || !deleted.has(r.source_document_id))
}
