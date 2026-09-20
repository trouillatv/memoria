import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export type CurateTrackedPointSubjectCode =
  | 'moved'
  | 'detached'
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
  targetCanonicalSubjectId?: string | null
  createdCanonicalSubjectId?: string
  existingCanonicalSubjectId?: string
  existingLabel?: string
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
  targetCanonicalSubjectId: string | null
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

export async function createSubjectFromTrackedPoint(input: {
  siteId: string
  trackedPointId: string
  label: string
  userId: string
  reason?: string | null
}): Promise<CurateTrackedPointSubjectResult> {
  const db = createAdminClient()
  const { data, error } = await (db as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('create_subject_from_tracked_point', {
    p_site_id: input.siteId,
    p_tracked_point_id: input.trackedPointId,
    p_label: input.label,
    p_user_id: input.userId,
    p_reason: input.reason ?? null,
  })

  if (error) {
    throw new Error(`createSubjectFromTrackedPoint: ${error.message}`)
  }

  return data as CurateTrackedPointSubjectResult
}

export type RenameCanonicalSubjectResult =
  | { ok: true; code: 'renamed' | 'no_op'; canonicalSubjectId: string; previousLabel?: string; newLabel?: string }
  | { ok: false; code: string }

export async function renameCanonicalSubjectManual(input: {
  siteId: string
  canonicalSubjectId: string
  newLabel: string
  userId: string
  reason?: string | null
}): Promise<RenameCanonicalSubjectResult> {
  const db = createAdminClient()
  const { data, error } = await (db as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('rename_canonical_subject_manual', {
    p_site_id: input.siteId,
    p_canonical_subject_id: input.canonicalSubjectId,
    p_new_label: input.newLabel,
    p_user_id: input.userId,
    p_reason: input.reason ?? null,
  })

  if (error) {
    throw new Error(`renameCanonicalSubjectManual: ${error.message}`)
  }

  return data as RenameCanonicalSubjectResult
}

export type MergeCanonicalSubjectsResult =
  | {
    ok: true
    code: 'merged' | 'no_op'
    sourceCanonicalSubjectId: string
    targetCanonicalSubjectId: string
    trackedPointsMoved?: number
    siteActionsMoved?: number
    siteDeadlinesMoved?: number
    siteReservesMoved?: number
  }
  | { ok: false; code: string }

export async function mergeCanonicalSubjectsManual(input: {
  siteId: string
  sourceCanonicalSubjectId: string
  targetCanonicalSubjectId: string
  userId: string
  reason?: string | null
}): Promise<MergeCanonicalSubjectsResult> {
  const db = createAdminClient()
  const { data, error } = await (db as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('merge_canonical_subjects_manual', {
    p_site_id: input.siteId,
    p_source_canonical_subject_id: input.sourceCanonicalSubjectId,
    p_target_canonical_subject_id: input.targetCanonicalSubjectId,
    p_user_id: input.userId,
    p_reason: input.reason ?? null,
  })

  if (error) {
    throw new Error(`mergeCanonicalSubjectsManual: ${error.message}`)
  }

  return data as MergeCanonicalSubjectsResult
}

export type TrackedPointSubjectCurationState = {
  isManual: boolean
  overrideId: string | null
  curationKind: 'target_subject' | 'detached' | 'created_subject' | null
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
    .select('id, curation_kind, previous_canonical_subject_id, target_canonical_subject_id')
    .eq('tracked_point_id', trackedPointId)
    .is('superseded_at', null)
    .maybeSingle()

  if (error) {
    const message = 'message' in error ? String(error.message) : 'unknown error'
    throw new Error(`getTrackedPointSubjectCurationState: ${message}`)
  }

  const row = data as {
    id: string
    curation_kind: 'target_subject' | 'detached' | 'created_subject' | null
    previous_canonical_subject_id: string | null
    target_canonical_subject_id: string | null
  } | null

  return {
    isManual: Boolean(row),
    overrideId: row?.id ?? null,
    curationKind: row?.curation_kind ?? null,
    previousCanonicalSubjectId: row?.previous_canonical_subject_id ?? null,
    targetCanonicalSubjectId: row?.target_canonical_subject_id ?? null,
  }
}
