// Fusion atomique de canonical_subject.
// Toute la logique de validation est dans la fonction SQL merge_canonical_subjects()
// (migration 311). Ce module est un wrapper TypeScript.

import { createAdminClient } from '@/lib/supabase/admin'

export interface MergeResult {
  source: string
  target: string
  sourceLabel: string
  targetLabel: string
  occurrencesMoved: number
  threadsMoved: number
  proposalsMoved: number
}

export async function mergeCanonicalSubjects(
  sourceId: string,
  targetId: string,
): Promise<{ ok: true; result: MergeResult } | { ok: false; error: string }> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .rpc('merge_canonical_subjects', {
      p_source_id: sourceId,
      p_target_id: targetId,
    })

  if (error) {
    // L'erreur Postgres remonte via le message RPC
    return { ok: false, error: error.message }
  }

  return { ok: true, result: data as MergeResult }
}
