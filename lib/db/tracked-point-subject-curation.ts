import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export type CurateTrackedPointSubjectCode =
  | 'moved'
  | 'no_op'
  | 'point_not_found'
  | 'target_subject_not_found'
  | 'no_active_thread_membership'
  | 'invalid_thread_identity'

export type CurateTrackedPointSubjectResult = {
  ok: boolean
  code: CurateTrackedPointSubjectCode | string
  overrideId?: string
  trackedPointId?: string
  previousCanonicalSubjectId?: string | null
  targetCanonicalSubjectId?: string
  threadIds?: string[]
  affectedCounts?: {
    subjectThreadIdentity?: number
    trackedPoint?: number
    trackedPointMember?: number
    canonicalBusinessObject?: number
    siteAction?: number
    siteDeadline?: number
    siteReserve?: number
    canonicalSubjectOccurrenceMoved?: number
    canonicalSubjectOccurrenceDeduped?: number
  }
}

export async function curateTrackedPointSubject(input: {
  siteId: string
  trackedPointId: string
  targetCanonicalSubjectId: string
  userId: string
  reason?: string | null
}): Promise<CurateTrackedPointSubjectResult> {
  const db = createAdminClient()
  const { data, error } = await (db as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('curate_tracked_point_subject', {
    p_site_id: input.siteId,
    p_tracked_point_id: input.trackedPointId,
    p_target_canonical_subject_id: input.targetCanonicalSubjectId,
    p_user_id: input.userId,
    p_reason: input.reason ?? null,
  })

  if (error) {
    throw new Error(`curateTrackedPointSubject: ${error.message}`)
  }

  return data as CurateTrackedPointSubjectResult
}

export type TrackedPointSubjectCurationState = {
  isManual: boolean
  overrideId: string | null
  previousCanonicalSubjectId: string | null
  targetCanonicalSubjectId: string | null
}

export async function getTrackedPointSubjectCurationState(trackedPointId: string): Promise<TrackedPointSubjectCurationState> {
  const db = createAdminClient()
  const { data, error } = await (db as unknown as {
    from: (table: 'tracked_point_subject_override') => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          is: (column: string, value: null) => {
            maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
          }
        }
      }
    }
  })
    .from('tracked_point_subject_override')
    .select('id, previous_canonical_subject_id, target_canonical_subject_id')
    .eq('tracked_point_id', trackedPointId)
    .is('superseded_at', null)
    .maybeSingle()

  if (error) {
    const message = 'message' in error ? String(error.message) : 'unknown error'
    throw new Error(`getTrackedPointSubjectCurationState: ${message}`)
  }

  const row = data as {
    id: string
    previous_canonical_subject_id: string | null
    target_canonical_subject_id: string | null
  } | null

  return {
    isManual: Boolean(row),
    overrideId: row?.id ?? null,
    previousCanonicalSubjectId: row?.previous_canonical_subject_id ?? null,
    targetCanonicalSubjectId: row?.target_canonical_subject_id ?? null,
  }
}
