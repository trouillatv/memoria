// Phase 6E.1C — productisation safe de la fusion Point↔Point (migration 392).
//
// Mandat Vincent : générique, jamais un bulk merge, jamais un LLM, jamais un changement du
// matcher. La fusion pilote 6E.1B (scripts/_p6e1b-03-apply-merge.ts) reste la référence
// fonctionnelle — ce module en reproduit exactement le pattern de re-vérification live, mais
// pour UNE paire quelconque désignée par pairId, jamais une boucle sur plusieurs paires.
//
// Toute direction (source/target) est TOUJOURS recalculée ici à partir de l'état vivant de la
// base via chooseCanonicalMergeTarget — jamais acceptée depuis un affichage client. Si la paire
// déclarée par pairId ne correspond plus à un état de consolidation en attente (ex. déjà
// fusionnée entre-temps par une autre session, ou candidates déjà résolues), aucune écriture
// n'est tentée : ALREADY_CONSOLIDATED (idempotence, pas une erreur) ou STALE_PAIR (recalcul
// impossible, l'appelant doit recharger la file).
//
// pairId = CandidatePointPair.pairKey (lib/knowledge/tracked-point-merge.ts) : les deux ids
// canoniques triés, joints par '~'. Format stable produit par le read-model de file
// (lib/knowledge/tracked-point-consolidation-queue.ts) et renvoyé tel quel par l'appelant.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  deriveCandidatePointPairs,
  resolveCanonicalPointId,
  chooseCanonicalMergeTarget,
  PointMergeCycleError,
  PointMergeTargetMissingError,
  PointMergeTargetRetiredError,
  PointMergeCrossSiteError,
  PointMergeAmbiguousCanonicalError,
  type CandidatePairPointRow,
  type CandidatePairMemberRow,
  type CandidatePairIdentityCandidateRow,
  type CandidatePointPair,
  type MergeGraphPoint,
} from '@/lib/knowledge/tracked-point-merge'

export type TrackedPointConsolidationPointDetail = {
  id: string
  label: string
  status: MergeGraphPoint['status']
  identityStatus: MergeGraphPoint['identityStatus']
  // createdAt (6E.4C) : issu de la même ligne rawPoints que mergeGraphPoints ci-dessus — jamais
  // une requête séparée. Seul usage : reconstituer un MergeGraphPoint pour la prévisualisation
  // d'impact (tracked-point-consolidation-queue.ts), en appelant chooseCanonicalMergeTarget telle
  // quelle, jamais un second calcul de direction.
  createdAt: string
}

export type TrackedPointConsolidationData = {
  points: CandidatePairPointRow[]
  mergeGraphPoints: MergeGraphPoint[]
  members: CandidatePairMemberRow[]
  candidates: CandidatePairIdentityCandidateRow[]
  pairs: CandidatePointPair[]
  // pointDetailsById : label + identityStatus par point, pour le seul usage d'affichage du
  // read-model de file (lib/knowledge/tracked-point-consolidation-queue.ts) — issu des mêmes
  // lignes rawPoints que mergeGraphPoints/points ci-dessus, jamais une requête séparée.
  pointDetailsById: Map<string, TrackedPointConsolidationPointDetail>
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

// loadTrackedPointConsolidationData : seul point de chargement live du site pour la
// consolidation — réutilisé par consolidateTrackedPoints/rejectPointIdentityPair (ce fichier)
// ET par loadConsolidationQueue (lib/knowledge/tracked-point-consolidation-queue.ts), pour ne
// jamais dupliquer la requête ni risquer une divergence entre ce que la file affiche et ce que
// l'écriture re-vérifie.
export async function loadTrackedPointConsolidationData(siteId: string): Promise<TrackedPointConsolidationData> {
  const db = createAdminClient()

  const { data: rawPoints, error: pointsErr } = await db
    .from('tracked_point')
    .select('id, site_id, label, status, merged_into_id, identity_status, created_at, founding_kind, founding_reference')
    .eq('site_id', siteId)
  if (pointsErr) throw pointsErr

  const points: CandidatePairPointRow[] = (rawPoints ?? []).map((p) => ({
    id: p.id,
    siteId: p.site_id,
    status: p.status,
    mergedIntoId: p.merged_into_id,
    foundingKind: p.founding_kind,
    foundingReference: p.founding_reference,
  }))
  const mergeGraphPoints: MergeGraphPoint[] = (rawPoints ?? []).map((p) => ({
    id: p.id,
    siteId: p.site_id,
    status: p.status,
    mergedIntoId: p.merged_into_id,
    identityStatus: p.identity_status,
    createdAt: p.created_at,
  }))

  const pointIds = points.map((p) => p.id)

  const { data: rawMembers, error: memErr } = await db
    .from('tracked_point_member')
    .select('tracked_point_id, subject_thread_id, scope, status')
    .in('tracked_point_id', pointIds.length > 0 ? pointIds : [NIL_UUID])
  if (memErr) throw memErr

  const members: CandidatePairMemberRow[] = (rawMembers ?? []).map((m) => ({
    trackedPointId: m.tracked_point_id,
    subjectThreadId: m.subject_thread_id,
    scope: (m.scope ?? 'thread') as CandidatePairMemberRow['scope'],
    status: m.status as CandidatePairMemberRow['status'],
  }))

  const { data: rawCandidates, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, site_id, candidate_point_id, subject_thread_id, status')
    .eq('site_id', siteId)
  if (candErr) throw candErr

  const candidates: CandidatePairIdentityCandidateRow[] = (rawCandidates ?? []).map((c) => ({
    id: c.id,
    siteId: c.site_id,
    candidatePointId: c.candidate_point_id,
    subjectThreadId: c.subject_thread_id,
    status: c.status as CandidatePairIdentityCandidateRow['status'],
  }))

  const pairs = deriveCandidatePointPairs(points, members, candidates)

  const pointDetailsById = new Map<string, TrackedPointConsolidationPointDetail>(
    (rawPoints ?? []).map((p) => [
      p.id,
      { id: p.id, label: p.label, status: p.status, identityStatus: p.identity_status, createdAt: p.created_at },
    ]),
  )

  return { points, mergeGraphPoints, members, candidates, pairs, pointDetailsById }
}

function parsePairId(pairId: string): [string, string] | null {
  const parts = pairId.split('~')
  if (parts.length !== 2) return null
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(parts[0]) || !uuidRe.test(parts[1])) return null
  return [parts[0], parts[1]]
}

export type ConsolidateTrackedPointsResult =
  | { ok: true; alreadyConsolidated: true; canonicalPointId: string }
  | {
      ok: true
      alreadyConsolidated: false
      sourceId: string
      targetId: string
      sourceLabel: string
      targetLabel: string
      candidatesAccepted: number
    }
  | { ok: false; error: string }

// consolidateTrackedPoints : recharge l'état vivant, retrouve la paire par pairId, recalcule
// TOUJOURS la direction canonique en base (jamais celle affichée côté client), puis appelle
// UNE FOIS merge_tracked_points. Si la paire ne se retrouve plus dans la file dérivée en
// direct, distingue explicitement idempotence (déjà consolidée → aucune écriture) et paire
// périmée (recalcul impossible → l'appelant doit recharger la file, aucune fusion tentée).
export async function consolidateTrackedPoints(params: {
  siteId: string
  pairId: string
}): Promise<ConsolidateTrackedPointsResult> {
  const db = createAdminClient()
  const { siteId, pairId } = params

  const { pairs, mergeGraphPoints, points } = await loadTrackedPointConsolidationData(siteId)
  const pair = pairs.find((p) => p.pairKey === pairId)

  if (!pair) {
    const parsed = parsePairId(pairId)
    if (!parsed) return { ok: false, error: 'INVALID_PAIR_ID' }
    const [a, b] = parsed

    const pointsById = new Map(points.map((p) => [p.id, p]))
    let canonicalA: string
    let canonicalB: string
    try {
      canonicalA = resolveCanonicalPointId(a, pointsById)
      canonicalB = resolveCanonicalPointId(b, pointsById)
    } catch (e) {
      if (
        e instanceof PointMergeCycleError ||
        e instanceof PointMergeTargetMissingError ||
        e instanceof PointMergeTargetRetiredError ||
        e instanceof PointMergeCrossSiteError
      ) {
        return { ok: false, error: `STALE_PAIR: ${e.message}` }
      }
      throw e
    }

    if (canonicalA === canonicalB) {
      return { ok: true, alreadyConsolidated: true, canonicalPointId: canonicalA }
    }
    return { ok: false, error: 'STALE_PAIR: la paire ne correspond plus à un état de consolidation en attente' }
  }

  const pointA = mergeGraphPoints.find((p) => p.id === pair.pointAId)
  const pointB = mergeGraphPoints.find((p) => p.id === pair.pointBId)
  if (!pointA || !pointB) return { ok: false, error: 'STALE_PAIR: point introuvable' }

  let targetId: string
  try {
    targetId = chooseCanonicalMergeTarget(pointA, pointB)
  } catch (e) {
    if (e instanceof PointMergeAmbiguousCanonicalError) return { ok: false, error: e.message }
    throw e
  }
  const sourceId = targetId === pointA.id ? pointB.id : pointA.id

  const { data, error } = await db.rpc('merge_tracked_points', {
    p_source_id: sourceId,
    p_target_id: targetId,
    p_candidate_ids: pair.candidateIds,
  })

  if (error) return { ok: false, error: error.message }

  const result = data as { source: string; target: string; sourceLabel: string; targetLabel: string; candidatesAccepted: number }
  return {
    ok: true,
    alreadyConsolidated: false,
    sourceId: result.source,
    targetId: result.target,
    sourceLabel: result.sourceLabel,
    targetLabel: result.targetLabel,
    candidatesAccepted: result.candidatesAccepted,
  }
}

export type RejectPointIdentityPairResult =
  | { ok: true; rejectedCount: number }
  | { ok: false; error: string }

// rejectPointIdentityPair : décision humaine "pas le même Point" pour EXACTEMENT la paire
// désignée par pairId — jamais les autres candidates de sa composante, même de taille ≥ 3
// (deriveCandidatePointPairs groupe strictement par pairKey, cf. tracked-point-merge.ts).
// REJECTED reste une décision locale à cette paire (doctrine Vincent) : aucune contrainte
// CANNOT_LINK globale n'est écrite ici ni réutilisée par un futur moteur.
export async function rejectPointIdentityPair(params: {
  siteId: string
  pairId: string
  actorUserId: string
}): Promise<RejectPointIdentityPairResult> {
  const db = createAdminClient()
  const { siteId, pairId, actorUserId } = params

  const { pairs } = await loadTrackedPointConsolidationData(siteId)
  const pair = pairs.find((p) => p.pairKey === pairId)
  if (!pair) return { ok: false, error: 'STALE_PAIR: paire introuvable ou déjà résolue' }

  const { data, error } = await db.rpc('reject_point_identity_pair', {
    p_candidate_ids: pair.candidateIds,
    p_resolved_by: actorUserId,
  })

  if (error) return { ok: false, error: error.message }

  const result = data as { candidateIds: string[]; rejectedCount: number; resolvedBy: string }
  return { ok: true, rejectedCount: result.rejectedCount }
}
