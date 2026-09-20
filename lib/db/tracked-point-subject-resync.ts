import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export type ResyncOrphanedTrackedPointVerdict =
  | 'resynced'
  | 'skipped_locked'
  | 'skipped_no_thread'
  | 'skipped_unresolved'
  | 'skipped_ambiguous'
  | 'skipped_target_invalid'

export type ResyncOrphanedTrackedPointRow = {
  trackedPointId: string
  label: string
  verdict: ResyncOrphanedTrackedPointVerdict | string
  targetCanonicalSubjectId: string | null
  reason: string | null
}

/**
 * Axe B — rattache automatiquement les tracked_point.canonical_subject_id
 * IS NULL d'un chantier dont l'identité canonique est désormais résolue
 * (RPC fn_resync_orphaned_tracked_points, migration 421). N'écrase jamais un
 * override humain, ne devine jamais une identité ambiguë ou non résolue.
 */
export async function resyncOrphanedTrackedPointsForSite(siteId: string): Promise<ResyncOrphanedTrackedPointRow[]> {
  const db = createAdminClient()
  const { data, error } = await (db as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('fn_resync_orphaned_tracked_points', { p_site_id: siteId })

  if (error) {
    throw new Error(`resyncOrphanedTrackedPointsForSite: ${error.message}`)
  }

  return ((data as Array<{
    out_tracked_point_id: string
    out_label: string
    out_verdict: string
    out_target_canonical_subject_id: string | null
    out_reason: string | null
  }> | null) ?? []).map((row) => ({
    trackedPointId: row.out_tracked_point_id,
    label: row.out_label,
    verdict: row.out_verdict,
    targetCanonicalSubjectId: row.out_target_canonical_subject_id,
    reason: row.out_reason,
  }))
}
