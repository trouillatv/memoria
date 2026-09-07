// Phase 6E.1C — read-model de file de consolidation Point↔Point (déliverable 3).
//
// Expose UNE ligne par paire candidate (jamais une ligne par composante) : pour toute
// composante candidate de taille > 2, deriveCandidatePointPairs produit déjà plusieurs
// CandidatePointPair distincts (une par arête) — ce module ne fait qu'annoter chacune de
// componentId/componentSize, il n'agrège JAMAIS plusieurs paires en une seule action groupée
// (déliverable 4 : aucune action "Fusionner la grappe" ne doit pouvoir exister en aval de ce
// read-model, faute de type pour la porter).
//
// componentId/componentSize sont recalculés à chaque chargement via computeConnectedComponents
// sur le graphe des paires EN ATTENTE — jamais un nombre codé en dur (ex. "94").

import { createAdminClient } from '@/lib/supabase/admin'
import { loadTrackedPointConsolidationData, type TrackedPointConsolidationPointDetail } from '@/lib/db/tracked-point-consolidation'
import {
  computeConnectedComponents,
  type CandidatePointPair,
  type TrackedPointMergeStatus,
  type TrackedPointMergeIdentityStatus,
} from '@/lib/knowledge/tracked-point-merge'

export type ConsolidationQueuePointSide = {
  id: string
  label: string
  status: TrackedPointMergeStatus
  identityStatus: TrackedPointMergeIdentityStatus
  cboCount: number
  hardMemberCount: number
}

export type ConsolidationQueueEntry = {
  pairId: string
  siteId: string
  pointA: ConsolidationQueuePointSide
  pointB: ConsolidationQueuePointSide
  candidateIds: string[]
  reciprocal: boolean
  componentId: string
  componentSize: number
}

export type ConsolidationQueue = {
  siteId: string
  entries: ConsolidationQueueEntry[]
  totalPairs: number
  complexComponentCount: number
}

// buildConsolidationQueue : pur. Lève si une extrémité de paire n'a pas de détail chargé
// (incohérence de chargement en amont, jamais silencieusement ignorée) ; cboCount/hardMemberCount
// défaut à 0 via ?? 0, un zéro légitime (aucune preuve/membre rattaché), pas un masquage de bug.
export function buildConsolidationQueue(
  siteId: string,
  pairs: CandidatePointPair[],
  pointDetailsById: Map<string, TrackedPointConsolidationPointDetail>,
  cboCountByPointId: Map<string, number>,
  hardMemberCountByPointId: Map<string, number>,
): ConsolidationQueue {
  const components = computeConnectedComponents(pairs.map((p) => ({ a: p.pointAId, b: p.pointBId })))
  const componentIdByPointId = new Map<string, string>()
  const componentSizeByPointId = new Map<string, number>()
  for (const members of components) {
    const componentId = [...members].sort()[0]
    for (const m of members) {
      componentIdByPointId.set(m, componentId)
      componentSizeByPointId.set(m, members.length)
    }
  }

  const side = (pointId: string): ConsolidationQueuePointSide => {
    const detail = pointDetailsById.get(pointId)
    if (!detail) throw new Error(`buildConsolidationQueue: point introuvable ${pointId}`)
    return {
      id: detail.id,
      label: detail.label,
      status: detail.status,
      identityStatus: detail.identityStatus,
      cboCount: cboCountByPointId.get(pointId) ?? 0,
      hardMemberCount: hardMemberCountByPointId.get(pointId) ?? 0,
    }
  }

  const entries: ConsolidationQueueEntry[] = pairs.map((pair) => ({
    pairId: pair.pairKey,
    siteId: pair.siteId,
    pointA: side(pair.pointAId),
    pointB: side(pair.pointBId),
    candidateIds: pair.candidateIds,
    reciprocal: pair.reciprocal,
    componentId: componentIdByPointId.get(pair.pointAId) ?? pair.pointAId,
    componentSize: componentSizeByPointId.get(pair.pointAId) ?? 2,
  }))

  const complexComponentCount = components.filter((members) => members.length > 2).length

  return { siteId, entries, totalPairs: entries.length, complexComponentCount }
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export async function loadConsolidationQueue(siteId: string): Promise<ConsolidationQueue> {
  const db = createAdminClient()
  const { pairs, pointDetailsById } = await loadTrackedPointConsolidationData(siteId)

  const pointIds = [...pointDetailsById.keys()]

  const { data: cboRows, error: cboErr } = await db
    .from('canonical_business_object')
    .select('tracked_point_id')
    .in('tracked_point_id', pointIds.length > 0 ? pointIds : [NIL_UUID])
  if (cboErr) throw cboErr

  const cboCountByPointId = new Map<string, number>()
  for (const row of cboRows ?? []) {
    if (!row.tracked_point_id) continue
    cboCountByPointId.set(row.tracked_point_id, (cboCountByPointId.get(row.tracked_point_id) ?? 0) + 1)
  }

  const { data: memberRows, error: memberErr } = await db
    .from('tracked_point_member')
    .select('tracked_point_id')
    .eq('status', 'active')
    .in('tracked_point_id', pointIds.length > 0 ? pointIds : [NIL_UUID])
  if (memberErr) throw memberErr

  const hardMemberCountByPointId = new Map<string, number>()
  for (const row of memberRows ?? []) {
    hardMemberCountByPointId.set(row.tracked_point_id, (hardMemberCountByPointId.get(row.tracked_point_id) ?? 0) + 1)
  }

  return buildConsolidationQueue(siteId, pairs, pointDetailsById, cboCountByPointId, hardMemberCountByPointId)
}
