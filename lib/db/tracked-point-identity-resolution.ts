// Fermeture humaine de IDENTITY_UNRESOLVED après rejet de tous les candidats (mandat Vincent,
// migration 404). Deux gestes symétriques, jamais un seul : "aucun des Points proposés n'est le
// bon, j'en choisis un autre existant" (associateIdentityTraceToPoint) OU "c'est une situation
// réellement nouvelle, je crée un Point" (createPointFromIdentityTrace).
//
// Même discipline que tracked-point-pending-resolution.ts : les RPC (migration 404) portent DÉJÀ
// toute la revalidation live métier (kind, status, target, cross-site, idempotence) — ces
// wrappers ne la dupliquent jamais. Leur seul ajout est la garde SITE_MISMATCH (la RPC, SECURITY
// DEFINER et sans notion d'appelant, ne peut structurellement pas savoir pour quel site
// l'appelant est autorisé) et la traduction de l'exception Postgres brute en résultat typé.

import { createAdminClient } from '@/lib/supabase/admin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ASSOCIATE_GUARD_CODES = [
  'INVALID_KIND',
  'INVALID_STATUS',
  'TARGET_MISMATCH',
  'INVALID_TARGET',
  'STALE_TARGET',
  'TARGET_CONFLICTED',
  'ABORT',
  'STALE_ALREADY_CONSUMED',
] as const

const CREATE_GUARD_CODES = ['INVALID_KIND', 'INVALID_STATUS', 'STALE_ALREADY_TRACKED', 'ABORT', 'LABEL_SOURCE_MISSING'] as const

function parseGuardCode(message: string, knownCodes: readonly string[]): string {
  const hit = knownCodes.find((code) => message.includes(code))
  return hit ?? `UNKNOWN_ERROR: ${message}`
}

export type AssociateIdentityTraceResult =
  | {
      ok: true
      result: 'associated' | 'already_resolved' | 'already_associated'
      pendingTraceId: string
      targetPointId: string
      sourceThreadId: string
      memberId: string
      membershipInserted: boolean
    }
  | { ok: false; error: string }

// associateIdentityTraceToPoint : "toujours recalculer live" — n'accepte jamais un résultat
// calculé par l'écran, appelle la RPC EXACTEMENT une fois par invocation. siteId est
// l'autorisation de l'appelant, jamais une donnée métier de plus : la RPC revalide déjà
// pending.site_id = target.site_id elle-même (guard 10, ABORT).
export async function associateIdentityTraceToPoint(params: {
  siteId: string
  pendingTraceId: string
  targetPointId: string
}): Promise<AssociateIdentityTraceResult> {
  const { siteId, pendingTraceId, targetPointId } = params
  const db = createAdminClient()

  if (!UUID_RE.test(pendingTraceId)) return { ok: false, error: 'INVALID_PENDING_TRACE_ID' }
  if (!UUID_RE.test(targetPointId)) return { ok: false, error: 'INVALID_TARGET_POINT_ID' }

  const { data: pendingRow, error: pendingErr } = await db
    .from('tracked_point_pending_trace')
    .select('id, site_id')
    .eq('id', pendingTraceId)
    .maybeSingle()
  if (pendingErr) throw pendingErr
  if (!pendingRow) return { ok: false, error: 'PENDING_TRACE_NOT_FOUND' }
  if (pendingRow.site_id !== siteId) return { ok: false, error: 'SITE_MISMATCH' }

  const { data, error } = await db.rpc('associate_identity_trace_to_point', {
    p_pending_trace_id: pendingTraceId,
    p_target_point_id: targetPointId,
  })
  if (error) return { ok: false, error: parseGuardCode(error.message, ASSOCIATE_GUARD_CODES) }

  const result = data as {
    result: 'associated' | 'already_resolved' | 'already_associated'
    targetPointId: string
    sourceThreadId: string
    memberId: string
    membershipInserted: boolean
  }

  return {
    ok: true,
    result: result.result,
    pendingTraceId,
    targetPointId: result.targetPointId,
    sourceThreadId: result.sourceThreadId,
    memberId: result.memberId,
    membershipInserted: result.membershipInserted,
  }
}

export type CreatePointFromIdentityTraceResult =
  | {
      ok: true
      result: 'created' | 'already_resolved'
      pendingTraceId: string
      targetPointId: string
      sourceThreadId: string
      memberId: string
      pointCreated: boolean
      membershipInserted: boolean
      label?: string
    }
  | { ok: false; error: string }

// createPointFromIdentityTrace : fonde un Point PROVISIONAL directement depuis la pending trace.
// Aucun paramètre métier au-delà de l'identité de la trace elle-même — le label, le
// canonicalSubjectId et le site sont tous dérivés live par la RPC, jamais fournis par l'appelant.
export async function createPointFromIdentityTrace(params: {
  siteId: string
  pendingTraceId: string
}): Promise<CreatePointFromIdentityTraceResult> {
  const { siteId, pendingTraceId } = params
  const db = createAdminClient()

  if (!UUID_RE.test(pendingTraceId)) return { ok: false, error: 'INVALID_PENDING_TRACE_ID' }

  const { data: pendingRow, error: pendingErr } = await db
    .from('tracked_point_pending_trace')
    .select('id, site_id')
    .eq('id', pendingTraceId)
    .maybeSingle()
  if (pendingErr) throw pendingErr
  if (!pendingRow) return { ok: false, error: 'PENDING_TRACE_NOT_FOUND' }
  if (pendingRow.site_id !== siteId) return { ok: false, error: 'SITE_MISMATCH' }

  const { data, error } = await db.rpc('create_point_from_identity_trace', {
    p_pending_trace_id: pendingTraceId,
  })
  if (error) return { ok: false, error: parseGuardCode(error.message, CREATE_GUARD_CODES) }

  const result = data as {
    result: 'created' | 'already_resolved'
    targetPointId: string
    sourceThreadId: string
    memberId: string
    pointCreated: boolean
    membershipInserted: boolean
    label?: string
  }

  return {
    ok: true,
    result: result.result,
    pendingTraceId,
    targetPointId: result.targetPointId,
    sourceThreadId: result.sourceThreadId,
    memberId: result.memberId,
    pointCreated: result.pointCreated,
    membershipInserted: result.membershipInserted,
    label: result.label,
  }
}
