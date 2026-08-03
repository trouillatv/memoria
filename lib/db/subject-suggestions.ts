import { createAdminClient } from '@/lib/supabase/admin'

export type SubjectSuggestionRow = {
  id: string
  subject_thread_id: string
  extraction_run_id: string | null
  proposal_label: string
  proposal_family: string
  candidate_canonical_subject_id: string | null
  candidate_label: string | null
  model_confidence: number | null
  reasoning: string | null
  shadow_decision: string
  resolution: string
  resolver_version: string
  resolved_at: string | null
  resolved_by: string | null
}

type RawRow = {
  id: string
  subject_thread_id: string
  extraction_run_id: string | null
  proposal_label: string
  proposal_family: string
  candidate_canonical_subject_id: string | null
  model_confidence: number | null
  reasoning: string | null
  shadow_decision: string
  resolution: string
  resolver_version: string
  resolved_at: string | null
  resolved_by: string | null
}

/**
 * Charge les suggestions sémantiques pour la section "Rapprochements suggérés".
 *
 * Inclut :
 *   - suggestions liées à ce run (extraction_run_id = runId)
 *   - suggestions rétroactives du site (extraction_run_id IS NULL, site_id = siteId)
 *
 * Toutes les résolutions (pending / accepted / rejected) sont incluses pour l'affichage.
 * Seules les suggestions avec candidat réel et shadow_decision utile sont retournées.
 */
export async function listSuggestionsForReview(
  runId: string,
  siteId: string | null,
): Promise<SubjectSuggestionRow[]> {
  const admin = createAdminClient()

  const BASE_SELECT = `
    id, subject_thread_id, extraction_run_id, proposal_label, proposal_family,
    candidate_canonical_subject_id, model_confidence, reasoning,
    shadow_decision, resolution, resolver_version, resolved_at, resolved_by
  `
  const USEFUL_DECISIONS = ['would_suggest', 'would_auto_assign']

  // 1. Suggestions liées au run courant
  const { data: runRows } = await admin
    .from('canonical_subject_suggestion')
    .select(BASE_SELECT)
    .eq('extraction_run_id', runId)
    .in('shadow_decision', USEFUL_DECISIONS)
    .not('candidate_canonical_subject_id', 'is', null)
    .order('created_at', { ascending: false })

  // 2. Suggestions rétroactives du site (sans run)
  let siteRows: RawRow[] = []
  if (siteId) {
    const { data } = await admin
      .from('canonical_subject_suggestion')
      .select(BASE_SELECT)
      .is('extraction_run_id', null)
      .eq('site_id', siteId)
      .in('shadow_decision', USEFUL_DECISIONS)
      .not('candidate_canonical_subject_id', 'is', null)
      .order('created_at', { ascending: false })
    siteRows = (data as RawRow[] | null) ?? []
  }

  const allRows: RawRow[] = [...((runRows as RawRow[] | null) ?? []), ...siteRows]
  if (allRows.length === 0) return []

  // Dédupliquer par id (un thread ne doit apparaître qu'une fois)
  const seen = new Set<string>()
  const deduped = allRows.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })

  // 3. Enrichir avec le label du canonical_subject candidat
  const csIds = [...new Set(deduped.map((r) => r.candidate_canonical_subject_id).filter(Boolean) as string[])]
  const csLabelMap = new Map<string, string>()

  if (csIds.length > 0) {
    const { data: csRows } = await admin
      .from('canonical_subject')
      .select('id, label')
      .in('id', csIds)
    for (const cs of csRows ?? []) csLabelMap.set(cs.id, cs.label)
  }

  return deduped.map((row) => ({
    ...row,
    candidate_label: row.candidate_canonical_subject_id
      ? (csLabelMap.get(row.candidate_canonical_subject_id) ?? null)
      : null,
  }))
}
