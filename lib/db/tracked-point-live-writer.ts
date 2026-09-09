// P6 Live Writer — Phase 4 (partie orchestration) : wrapper au-dessus de la RPC unique
// fn_reconcile_tracked_point_unit (migration 401, NON APPLIQUÉE dans ce lot).
//
// Ce module ne classifie rien et ne charge aucune donnée live : il reçoit une FoundingUnit
// déjà construite (buildFoundingUnits, lib/knowledge/tracked-point-founding.ts) par un
// appelant qui a déjà chargé les props/CBO nécessaires, la transforme en plan pur
// (planPointForUnit/planPendingTraceForUnit, lib/knowledge/tracked-point-write-plan.ts) et
// en fingerprint (buildFingerprint, lib/knowledge/tracked-point-fingerprint.ts), puis appelle
// la RPC exactement une fois par invocation — même doctrine "toujours recalculer live" que
// associatePendingResolutionToPoint (tracked-point-pending-resolution.ts).
//
// Ce module ne brancherait, à lui seul, aucun producteur réel (extraction historique, visite
// terrain) sur ce writer : câbler un appelant qui charge les données live et invoque cette
// fonction est une extension de périmètre séparée (mandat : NO GO ACTIVATION PROD).
//
// Frozen — voir docs/tracked-points/p6-live-writer-design.md §3 (machine à états), §7.

import { createAdminClient } from '@/lib/supabase/admin'
import type { FoundingUnit } from '@/lib/knowledge/tracked-point-founding'
import { buildFingerprint } from '@/lib/knowledge/tracked-point-fingerprint'
import {
  crossThreadConcurrentPointIds,
  foundingReferenceOf,
  planPendingTraceForUnit,
  planPointForUnit,
  type PlannedPendingTrace,
  type PlannedPoint,
  type PlanUnitContext,
} from '@/lib/knowledge/tracked-point-write-plan'
import type { TrackedPointCandidate } from '@/lib/knowledge/tracked-point-membership-candidates'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ReconcileVerdict = 'AUTO_CREATED' | 'AUTO_LINKED' | 'NEEDS_HUMAN' | 'IGNORED_NOT_TRACKABLE'

export type ReconcileWritePattern =
  | 'CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK'
  | 'CREATE_POINT_WITH_MEMBERSHIP'
  | 'ATTACH_MEMBER'
  | 'ENRICH_EXISTING_POINT'
  | 'CREATE_PENDING_TRACE'
  | 'CREATE_CANDIDATES'
  | 'NOOP'
  | 'IGNORE_NOT_TRACKABLE'

export type ReconcileTrackedPointUnitResult =
  | {
      ok: true
      unitKey: string
      verdict: ReconcileVerdict
      writePattern: ReconcileWritePattern
      targetPointId: string | null
      replayed: boolean
      reconcileEventId: string
      pendingTraceId: string | null
      newCandidateIds: string[]
    }
  | { ok: false; error: string }

// Codes portés par les RAISE EXCEPTION de la RPC (migration 401) — extraits du message
// Postgres, jamais reconstruits ailleurs (même convention que tracked-point-pending-
// resolution.ts:parseGuardCode).
const KNOWN_GUARD_CODES = ['INVALID_PLAN', 'INVALID_SCOPE', 'CBO_NOT_FOUND', 'DRIFT_CBO_LINK_MISSING'] as const

function parseGuardCode(message: string): string {
  const hit = KNOWN_GUARD_CODES.find((code) => message.includes(code))
  return hit ?? `UNKNOWN_ERROR: ${message}`
}

// Exporté pour le témoin 14 (rollback après échec forcé) : ce témoin doit appeler le harness
// test-only (test_only.fn_reconcile_tracked_point_unit_with_failpoint) directement plutôt que
// ce wrapper — il a donc besoin de la même sérialisation exacte du plan, sans la dupliquer.
export function plannedPointPayload(p: PlannedPoint) {
  return {
    label: p.label,
    foundingKind: p.founding_kind,
    identityStatus: p.identity_status,
    foundingSource: p.founding_source,
    foundingReference: p.founding_reference,
    hasUpstreamDefect: p.has_upstream_defect,
    seedSource: p.seed_source,
    canonicalSubjectId: p.canonical_subject_id,
    canonicalSubjectLabel: p.canonical_subject_label,
    member: {
      scope: p.member.scope,
      proposalIds: p.member.proposal_ids,
    },
  }
}

function plannedPendingTracePayload(t: PlannedPendingTrace) {
  return { kind: t.kind, reason: t.reason }
}

/**
 * reconcileTrackedPointUnit — appelle fn_reconcile_tracked_point_unit exactement une fois
 * pour la FoundingUnit fournie. N'accepte jamais un plan ou un fingerprint précalculé par
 * l'appelant : les deux sont recalculés ici à partir de `unit`, pour qu'aucun appelant ne
 * puisse faire dévier la RPC d'une classification obsolète.
 *
 * siteId est l'autorisation de l'appelant — la RPC, SECURITY DEFINER et sans notion
 * d'appelant, ne peut pas la vérifier elle-même (même garde que le wrapper 396).
 */
export async function reconcileTrackedPointUnit(params: {
  siteId: string
  unit: FoundingUnit
  ctx?: PlanUnitContext
  sourceKind: 'historical_pdf' | 'field_visit' | 'meeting'
  sourceRefId: string
  // D1 (Round 2, Vincent) : candidats de Points actifs du site déjà chargés par l'appelant,
  // utilisés UNIQUEMENT pour détecter une concurrence cross-thread avant l'auto-création
  // PROVISIONAL — jamais un second moteur de décision (crossThreadConcurrentPointIds réutilise
  // evaluateMembershipCandidate tel quel, sans llmJudge). Le RPC revérifie chaque id sous
  // verrou avant d'en tenir compte.
  sitePoints?: TrackedPointCandidate[]
}): Promise<ReconcileTrackedPointUnitResult> {
  const { siteId, unit, ctx, sourceKind, sourceRefId, sitePoints = [] } = params

  if (!UUID_RE.test(siteId)) return { ok: false, error: 'INVALID_SITE_ID' }
  if (!UUID_RE.test(unit.threadId)) return { ok: false, error: 'INVALID_THREAD_ID' }
  if (!UUID_RE.test(sourceRefId)) return { ok: false, error: 'INVALID_SOURCE_REF_ID' }

  const plannedPoint = planPointForUnit(unit, ctx)
  const plannedPendingTrace = plannedPoint ? null : planPendingTraceForUnit(unit)
  if (plannedPoint && plannedPendingTrace) return { ok: false, error: 'INVALID_PLAN' }

  const unitKey = foundingReferenceOf(unit)
  const { snapshot, fingerprint } = buildFingerprint(unit)
  const crossThreadCandidateIds = crossThreadConcurrentPointIds(unit, sitePoints, ctx)

  const db = createAdminClient()
  const { data, error } = await db.rpc('fn_reconcile_tracked_point_unit', {
    p_site_id: siteId,
    p_unit_key: unitKey,
    p_thread_id: unit.threadId,
    p_scope: unit.scope,
    p_input_snapshot: snapshot,
    p_input_fingerprint: fingerprint,
    p_source_kind: sourceKind,
    p_source_ref_id: sourceRefId,
    p_planned_point: plannedPoint ? plannedPointPayload(plannedPoint) : null,
    p_planned_pending_trace: plannedPendingTrace ? plannedPendingTracePayload(plannedPendingTrace) : null,
    p_cross_thread_candidate_point_ids: crossThreadCandidateIds,
  })
  if (error) return { ok: false, error: parseGuardCode(error.message) }

  const result = data as {
    unitKey: string
    verdict: ReconcileVerdict
    writePattern: ReconcileWritePattern
    targetPointId: string | null
    replayed: boolean
    reconcileEventId: string
    pendingTraceId: string | null
    newCandidateIds: string[]
  }

  return {
    ok: true,
    unitKey: result.unitKey,
    verdict: result.verdict,
    writePattern: result.writePattern,
    targetPointId: result.targetPointId,
    replayed: result.replayed,
    reconcileEventId: result.reconcileEventId,
    pendingTraceId: result.pendingTraceId,
    newCandidateIds: result.newCandidateIds ?? [],
  }
}
