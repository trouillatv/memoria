// Phase 6E.3B.3C — productisation de la résolution orpheline (RESOLUTION_WITHOUT_KNOWN_PROBLEM),
// wrapper au-dessus de la RPC associate_pending_resolution_to_point (migration 396, pilotée
// réellement une fois en 6E.3B.3B). Zéro nouvel APPLY métier dans cette phase — ce module rend
// la RPC déjà validée appelable en toute sécurité par un futur appelant (server action / UI),
// il ne change ni son contrat ni son comportement.
//
// La RPC porte DÉJÀ toute la revalidation live métier (kind, status, evidence figée, target
// actif/non-merged/non-retired/non-CONFLICTED, cross-site, candidat optionnel encore cohérent,
// idempotence) — ce wrapper ne la duplique jamais. Son seul ajout est ce que la RPC, SECURITY
// DEFINER et sans notion d'appelant, ne peut structurellement pas faire : vérifier que la
// pending trace visée appartient bien au site pour lequel l'appelant est autorisé (même garde
// SITE_MISMATCH que acceptTraceIdentityCandidate/rejectTraceIdentityCandidate,
// tracked-point-trace-acceptance.ts) — et traduire l'exception Postgres brute en résultat typé.
//
// p_identity_candidate_id est optionnel dans la RPC (guard 14 de la migration 396 est déjà
// conditionnel) : ce wrapper ne le rend PAS obligatoire. Passer candidateId=undefined déclenche
// le mode HUMAN_SELECTED_TARGET (0 identity_candidate créé/modifié) ; le fournir déclenche
// KNOWN_CANDIDATE_TARGET (le candidat exact est revalidé par la RPC puis accepté). Ce sont deux
// modes du MÊME appel, jamais deux fonctions séparées — la RPC ne bifurque que sur la présence
// du paramètre.

import { createAdminClient } from '@/lib/supabase/admin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AssociatePendingResolutionResult =
  | {
      ok: true
      result: 'associated' | 'already_resolved' | 'already_associated'
      pendingTraceId: string
      targetPointId: string
      sourceThreadId: string
      memberId: string
      membershipInserted: boolean
      candidateAccepted: boolean
    }
  | { ok: false; error: string }

// Préfixes de guard portés par la RPC (migration 396) — extraits du message d'erreur Postgres,
// jamais reconstruits ailleurs : un seul endroit connaît le vocabulaire des guards (la RPC
// elle-même, via ses RAISE EXCEPTION). Ce tableau ne fait que le reconnaître.
const KNOWN_GUARD_CODES = [
  'INVALID_KIND',
  'INVALID_STATUS',
  'TARGET_MISMATCH',
  'EVIDENCE_SCOPE_UNRESOLVED',
  'EVIDENCE_MISSING',
  'EVIDENCE_SCOPE_INVALID',
  'INVALID_TARGET',
  'STALE_TARGET',
  'TARGET_CONFLICTED',
  'ABORT',
  'STALE_CANDIDATE',
  'STALE_ALREADY_CONSUMED',
] as const

function parseGuardCode(message: string): string {
  const hit = KNOWN_GUARD_CODES.find((code) => message.includes(code))
  return hit ?? `UNKNOWN_ERROR: ${message}`
}

// associatePendingResolutionToPoint : "toujours recalculer live" (mandat 6E.3B.3C, point 2) —
// n'accepte jamais un résultat calculé par l'écran, appelle la RPC EXACTEMENT une fois par
// invocation. siteId est l'autorisation de l'appelant, jamais une donnée métier de plus : la
// RPC revalide déjà pending.site_id = target.site_id elle-même (guard 13, ABORT).
export async function associatePendingResolutionToPoint(params: {
  siteId: string
  pendingTraceId: string
  targetPointId: string
  candidateId?: string | null
}): Promise<AssociatePendingResolutionResult> {
  const { siteId, pendingTraceId, targetPointId, candidateId } = params
  const db = createAdminClient()

  if (!UUID_RE.test(pendingTraceId)) return { ok: false, error: 'INVALID_PENDING_TRACE_ID' }
  if (!UUID_RE.test(targetPointId)) return { ok: false, error: 'INVALID_TARGET_POINT_ID' }
  if (candidateId != null && !UUID_RE.test(candidateId)) return { ok: false, error: 'INVALID_CANDIDATE_ID' }

  const { data: pendingRow, error: pendingErr } = await db
    .from('tracked_point_pending_trace')
    .select('id, site_id')
    .eq('id', pendingTraceId)
    .maybeSingle()
  if (pendingErr) throw pendingErr
  if (!pendingRow) return { ok: false, error: 'PENDING_TRACE_NOT_FOUND' }
  if (pendingRow.site_id !== siteId) return { ok: false, error: 'SITE_MISMATCH' }

  const { data, error } = await db.rpc('associate_pending_resolution_to_point', {
    p_pending_trace_id: pendingTraceId,
    p_target_point_id: targetPointId,
    p_identity_candidate_id: candidateId ?? null,
  })
  if (error) return { ok: false, error: parseGuardCode(error.message) }

  const result = data as {
    result: 'associated' | 'already_resolved' | 'already_associated'
    targetPointId: string
    sourceThreadId: string
    memberId: string
    membershipInserted: boolean
    candidateAccepted: boolean
  }

  return {
    ok: true,
    result: result.result,
    pendingTraceId,
    targetPointId: result.targetPointId,
    sourceThreadId: result.sourceThreadId,
    memberId: result.memberId,
    membershipInserted: result.membershipInserted,
    candidateAccepted: result.candidateAccepted,
  }
}

export type DismissPendingTraceResult =
  | { ok: true; alreadyDismissed: boolean; pendingTraceId: string }
  | { ok: false; error: string }

// dismissPendingTrace : geste humain "abandon" — status pending → dismissed, RIEN d'autre.
// Jamais de Point, jamais de membership, jamais de reducer touché (mandat 6E.3B.3C, point 8).
// Simple UPDATE mono-ligne gardé par WHERE status='pending', même convention que
// rejectTraceIdentityCandidate (tracked-point-trace-acceptance.ts) : pas de RPC nécessaire pour
// une mutation à une seule table, avec re-lecture explicite en cas de course perdue plutôt que
// de deviner l'issue.
export async function dismissPendingTrace(params: {
  siteId: string
  pendingTraceId: string
  actorUserId: string
}): Promise<DismissPendingTraceResult> {
  const { siteId, pendingTraceId, actorUserId } = params
  const db = createAdminClient()

  if (!UUID_RE.test(pendingTraceId)) return { ok: false, error: 'INVALID_PENDING_TRACE_ID' }

  const { data: pendingRow, error: pendingErr } = await db
    .from('tracked_point_pending_trace')
    .select('id, site_id, status')
    .eq('id', pendingTraceId)
    .maybeSingle()
  if (pendingErr) throw pendingErr
  if (!pendingRow) return { ok: false, error: 'PENDING_TRACE_NOT_FOUND' }
  if (pendingRow.site_id !== siteId) return { ok: false, error: 'SITE_MISMATCH' }
  if (pendingRow.status === 'dismissed') return { ok: true, alreadyDismissed: true, pendingTraceId }
  if (pendingRow.status === 'resolved') {
    return { ok: false, error: 'ALREADY_RESOLVED: pending trace déjà résolue vers un Point, dismiss impossible' }
  }

  const { data: updated, error: updErr } = await db
    .from('tracked_point_pending_trace')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: actorUserId })
    .eq('id', pendingTraceId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (updErr) throw updErr
  if (updated) return { ok: true, alreadyDismissed: false, pendingTraceId }

  // Course perdue entre le SELECT et l'UPDATE gardé : ne jamais deviner, relire l'état réel.
  const { data: afterRace, error: raceErr } = await db
    .from('tracked_point_pending_trace')
    .select('status')
    .eq('id', pendingTraceId)
    .single()
  if (raceErr) throw raceErr
  if (afterRace.status === 'dismissed') return { ok: true, alreadyDismissed: true, pendingTraceId }
  return {
    ok: false,
    error: `ALREADY_RESOLVED: status=${afterRace.status} après course concurrente, dismiss impossible`,
  }
}

// Phase 6E.8A — report temporel ("Me le redemander…"), geste distinct de dismissPendingTrace.
// Décision d'architecture de Vincent (audit 6E.8, verdict ASK_LATER_MODEL_MISSING) : status
// reste 'pending' — un report N'EST PAS un abandon, seulement une métadonnée de visibilité
// additive (deferred_until/deferred_at/deferred_by, migration 399). Durées fixes uniquement,
// validées ici et jamais côté client seul : aucune date libre.
export const DEFER_DURATION_DAYS = [1, 7, 30] as const
export type DeferDurationDays = (typeof DEFER_DURATION_DAYS)[number]

export type DeferPendingTraceResult =
  | { ok: true; pendingTraceId: string; deferredUntil: string }
  | { ok: false; error: string }

// pendingTraceVisibleFilter : prédicat de visibilité partagé par toutes les files qui
// consomment tracked_point_pending_trace (status='pending' déjà appliqué par l'appelant) —
// un seul endroit connaît la formule "deferred_until NULL OU déjà passé", pour qu'elle ne
// diverge jamais entre tracked-point-pending-resolution-queue.ts,
// tracked-point-pending-trackability-queue.ts et tracked-point-evidence-scope-queue.ts.
export function pendingTraceVisibleFilter(nowIso: string): string {
  return `deferred_until.is.null,deferred_until.lte.${nowIso}`
}

// deferPendingTrace : même squelette que dismissPendingTrace (UPDATE mono-ligne gardé par
// WHERE status='pending', re-lecture explicite en cas de course perdue). Un report ne touche
// jamais status/resolved_at/resolved_by/evidence_status — seulement les trois colonnes de
// report elles-mêmes. Rejouable tant que la trace reste 'pending' (un nouveau report
// remplace simplement l'échéance précédente, jamais un cumul).
export async function deferPendingTrace(params: {
  siteId: string
  pendingTraceId: string
  actorUserId: string
  durationDays: DeferDurationDays
}): Promise<DeferPendingTraceResult> {
  const { siteId, pendingTraceId, actorUserId, durationDays } = params
  const db = createAdminClient()

  if (!UUID_RE.test(pendingTraceId)) return { ok: false, error: 'INVALID_PENDING_TRACE_ID' }
  if (!DEFER_DURATION_DAYS.includes(durationDays)) return { ok: false, error: 'INVALID_DURATION' }

  const { data: pendingRow, error: pendingErr } = await db
    .from('tracked_point_pending_trace')
    .select('id, site_id, status')
    .eq('id', pendingTraceId)
    .maybeSingle()
  if (pendingErr) throw pendingErr
  if (!pendingRow) return { ok: false, error: 'PENDING_TRACE_NOT_FOUND' }
  if (pendingRow.site_id !== siteId) return { ok: false, error: 'SITE_MISMATCH' }
  if (pendingRow.status === 'dismissed') {
    return { ok: false, error: 'ALREADY_DISMISSED: pending trace déjà écartée, report impossible' }
  }
  if (pendingRow.status === 'resolved') {
    return { ok: false, error: 'ALREADY_RESOLVED: pending trace déjà résolue vers un Point, report impossible' }
  }

  const now = new Date()
  const deferredUntil = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: updated, error: updErr } = await db
    .from('tracked_point_pending_trace')
    .update({ deferred_until: deferredUntil, deferred_at: now.toISOString(), deferred_by: actorUserId })
    .eq('id', pendingTraceId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (updErr) throw updErr
  if (updated) return { ok: true, pendingTraceId, deferredUntil }

  // Course perdue entre le SELECT et l'UPDATE gardé : ne jamais deviner, relire l'état réel.
  const { data: afterRace, error: raceErr } = await db
    .from('tracked_point_pending_trace')
    .select('status')
    .eq('id', pendingTraceId)
    .single()
  if (raceErr) throw raceErr
  return {
    ok: false,
    error: `ALREADY_RESOLVED: status=${afterRace.status} après course concurrente, report impossible`,
  }
}
