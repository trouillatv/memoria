// Phase 6E.3B.2 — wrapper fin de la RPC confirm_pending_trackability (migration 395), pilotée
// et testée en intégration (tests/lib/db/tracked-point-confirm-trackability.test.ts). Même
// convention que associatePendingResolutionToPoint (tracked-point-pending-resolution.ts) et
// resolvePendingEvidenceScope (tracked-point-pending-evidence-scope.ts) : la RPC porte déjà
// toute la revalidation métier (kind, status, evidence figée, thread pas déjà tracké ailleurs,
// cross-site) — ce wrapper ne la duplique jamais. Son seul ajout est la garde SITE_MISMATCH
// (RPC SECURITY DEFINER sans notion d'appelant) et la traduction de l'exception Postgres brute
// en résultat typé.
//
// Le geste "Non" (refuser de suivre cette situation) réutilise dismissPendingTrace, déjà
// générique à tous les kinds de pending trace (tracked-point-pending-resolution.ts) — aucune
// nouvelle fonction dismiss n'est créée ici.

import { createAdminClient } from '@/lib/supabase/admin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ConfirmPendingTrackabilityResult =
  | {
      ok: true
      result: 'confirmed' | 'already_resolved'
      pendingTraceId: string
      targetPointId: string
      memberId: string
      label: string
      pointCreated: boolean
      membershipInserted: boolean
    }
  | { ok: false; error: string }

// Guards portés par la RPC (migration 395) — extraits du message d'erreur Postgres, jamais
// reconstruits ailleurs (cf. tests/lib/db/tracked-point-confirm-trackability.test.ts).
const KNOWN_GUARD_CODES = [
  'INVALID_KIND',
  'INVALID_STATUS',
  'EVIDENCE_SCOPE_UNRESOLVED',
  'STALE_ALREADY_TRACKED',
  'ABORT',
] as const

function parseGuardCode(message: string): string {
  const hit = KNOWN_GUARD_CODES.find((code) => message.includes(code))
  return hit ?? `UNKNOWN_ERROR: ${message}`
}

// confirmPendingTrackability : "toujours recalculer live" — n'accepte jamais un état précalculé
// par l'écran, appelle la RPC EXACTEMENT une fois par invocation. siteId est l'autorisation de
// l'appelant, jamais une donnée métier de plus : la RPC revalide déjà le cross-site elle-même
// (guard ABORT via subject_thread_identity).
export async function confirmPendingTrackability(params: {
  siteId: string
  pendingTraceId: string
}): Promise<ConfirmPendingTrackabilityResult> {
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

  const { data, error } = await db.rpc('confirm_pending_trackability', {
    p_pending_trace_id: pendingTraceId,
  })
  if (error) return { ok: false, error: parseGuardCode(error.message) }

  const result = data as {
    result: 'confirmed' | 'already_resolved'
    targetPointId: string
    memberId: string
    label: string
    pointCreated: boolean
    membershipInserted: boolean
  }

  return {
    ok: true,
    result: result.result,
    pendingTraceId,
    targetPointId: result.targetPointId,
    memberId: result.memberId,
    label: result.label,
    pointCreated: result.pointCreated,
    membershipInserted: result.membershipInserted,
  }
}
