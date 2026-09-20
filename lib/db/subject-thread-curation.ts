import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export type CurateSubjectThreadIdentityCode =
  | 'retargeted'
  | 'no_op'
  | 'thread_not_found'
  | 'target_subject_not_found'

export type CurateSubjectThreadIdentityResult = {
  ok: boolean
  code: CurateSubjectThreadIdentityCode | string
  subjectThreadId?: string
  canonicalSubjectId?: string
  previousCanonicalSubjectId?: string | null
  targetCanonicalSubjectId?: string | null
  trackedPointId?: string | null
  affectedCounts?: {
    trackedPoint?: number
    canonicalBusinessObject?: number
    siteAction?: number
    siteDeadline?: number
    siteReserve?: number
    canonicalSubjectOccurrenceMoved?: number
    canonicalSubjectOccurrenceDeduped?: number
  }
}

/**
 * Axe B2 — déplace un unique subject_thread_identity vers un autre
 * canonical_subject (RPC curate_subject_thread_identity, migration 422).
 * Réservé aux threads sans tracked_point (sinon curateTrackedPointSubject) ;
 * ne fusionne jamais deux Subjects, ne touche jamais les autres threads du
 * Subject source.
 */
export async function curateSubjectThreadIdentity(input: {
  siteId: string
  subjectThreadId: string
  targetCanonicalSubjectId: string
  userId: string
  reason?: string | null
}): Promise<CurateSubjectThreadIdentityResult> {
  const db = createAdminClient()
  const { data, error } = await (db as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('curate_subject_thread_identity', {
    p_site_id: input.siteId,
    p_subject_thread_id: input.subjectThreadId,
    p_target_canonical_subject_id: input.targetCanonicalSubjectId,
    p_user_id: input.userId,
    p_reason: input.reason ?? null,
  })

  if (error) {
    throw new Error(`curateSubjectThreadIdentity: ${error.message}`)
  }

  return data as CurateSubjectThreadIdentityResult
}
