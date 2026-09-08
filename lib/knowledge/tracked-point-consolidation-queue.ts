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
  loadTrackedPointReadModel,
  selectEligibleProposalIds,
  type PointReadModelEntry,
  type PointMembershipRow,
} from '@/lib/knowledge/tracked-point-read-model'
import {
  computeConnectedComponents,
  chooseCanonicalMergeTarget,
  PointMergeAmbiguousCanonicalError,
  type CandidatePointPair,
  type TrackedPointMergeStatus,
  type TrackedPointMergeIdentityStatus,
  type MergeGraphPoint,
} from '@/lib/knowledge/tracked-point-merge'

// PointProofView (6E.4B/A2, mandat Vincent 2026-09-08) : preuve documentaire RÉELLE d'un Point —
// résolue via ses memberships HARD/actifs → document_extraction_proposal, JAMAIS via
// canonical_business_object (un CBO est une obligation métier, pas une preuve ; cboCount reste
// un compteur d'obligations, distinct de proofCount). Un seul chemin de provenance existe
// aujourd'hui (HARD membership), d'où provenanceKind toujours 'hard_membership' — pas un champ
// mort, juste pas encore de second cas réel à distinguer.
export type PointProofView = {
  proposalId: string
  documentId: string
  documentFilename: string | null
  documentType: string | null
  effectiveDate: string | null
  sourcePage: number | null
  sourceExcerpt: string | null
  extractedLabel: string
  hasVerbatimExcerpt: boolean
  provenanceKind: 'hard_membership'
}

export type ConsolidationQueuePointSide = {
  id: string
  label: string
  status: TrackedPointMergeStatus
  identityStatus: TrackedPointMergeIdentityStatus
  derivedState: PointReadModelEntry['derivedState'] | null
  subjectId: string | null
  subjectLabel: string | null
  firstAppearanceAt: string | null
  lastAppearanceAt: string | null
  cboCount: number
  hardMemberCount: number
  proofs: PointProofView[]
  proofCount: number
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
  // predictedTargetPointId/predictedSourcePointId (6E.4C) : direction PRÉVUE de la fusion,
  // recalculée avec chooseCanonicalMergeTarget — la même fonction que consolidateTrackedPoints
  // appelle en écriture, jamais un second moteur. C'est une PRÉDICTION affichée avant clic :
  // consolidateTrackedPoints recharge l'état vivant et recalcule à nouveau au moment du clic,
  // seule cette dernière exécution fait foi. Null quand identityStatus=CONFLICTED des deux côtés
  // (direction non déterminable) — jamais devinée.
  predictedTargetPointId: string | null
  predictedSourcePointId: string | null
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
  readModelByPointId: Map<string, PointReadModelEntry>,
  subjectLabelBySubjectId: Map<string, string | null>,
  proofsByPointId: Map<string, { proofs: PointProofView[]; totalCount: number }>,
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
    const readModel = readModelByPointId.get(pointId)
    const subjectId = readModel?.ownerCanonicalSubjectId ?? null
    const proofEntry = proofsByPointId.get(pointId)
    return {
      id: detail.id,
      label: detail.label,
      status: detail.status,
      identityStatus: detail.identityStatus,
      derivedState: readModel?.derivedState ?? null,
      subjectId,
      subjectLabel: subjectId ? (subjectLabelBySubjectId.get(subjectId) ?? null) : null,
      firstAppearanceAt: readModel?.trajectory[0]?.effectiveAt ?? null,
      lastAppearanceAt: readModel?.latestMeaningfulEventAt ?? null,
      cboCount: cboCountByPointId.get(pointId) ?? 0,
      hardMemberCount: hardMemberCountByPointId.get(pointId) ?? 0,
      proofs: proofEntry?.proofs ?? [],
      proofCount: proofEntry?.totalCount ?? 0,
    }
  }

  // toMergeGraphPoint (6E.4C) : reconstruit le MergeGraphPoint minimal requis par
  // chooseCanonicalMergeTarget (id/identityStatus/createdAt seuls, cf. tracked-point-merge.ts) à
  // partir du même pointDetailsById que side() ci-dessus. mergedIntoId:null est exact ici — les
  // deux extrémités d'une CandidatePointPair sont déjà des points canoniques actifs
  // (resolveCanonicalPointId/deriveCandidatePointPairs les résolvent en amont).
  const toMergeGraphPoint = (pointId: string): MergeGraphPoint | null => {
    const detail = pointDetailsById.get(pointId)
    if (!detail) return null
    return {
      id: detail.id,
      siteId,
      status: detail.status,
      mergedIntoId: null,
      identityStatus: detail.identityStatus,
      createdAt: detail.createdAt,
    }
  }

  const entries: ConsolidationQueueEntry[] = pairs.map((pair) => {
    const pointAGraph = toMergeGraphPoint(pair.pointAId)
    const pointBGraph = toMergeGraphPoint(pair.pointBId)
    let predictedTargetPointId: string | null = null
    let predictedSourcePointId: string | null = null
    if (pointAGraph && pointBGraph) {
      try {
        predictedTargetPointId = chooseCanonicalMergeTarget(pointAGraph, pointBGraph)
        predictedSourcePointId = predictedTargetPointId === pointAGraph.id ? pointBGraph.id : pointAGraph.id
      } catch (e) {
        if (!(e instanceof PointMergeAmbiguousCanonicalError)) throw e
        // CONFLICTED des deux côtés : direction non déterminable, reste null (jamais devinée).
      }
    }
    return {
      pairId: pair.pairKey,
      siteId: pair.siteId,
      pointA: side(pair.pointAId),
      pointB: side(pair.pointBId),
      candidateIds: pair.candidateIds,
      reciprocal: pair.reciprocal,
      componentId: componentIdByPointId.get(pair.pointAId) ?? pair.pointAId,
      componentSize: componentSizeByPointId.get(pair.pointAId) ?? 2,
      predictedTargetPointId,
      predictedSourcePointId,
    }
  })

  const complexComponentCount = components.filter((members) => members.length > 2).length

  return { siteId, entries, totalPairs: entries.length, complexComponentCount }
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000'
const PROOF_DISPLAY_CAP = 3

// loadPointProofsByPointId (6E.4B/A2) : résout les preuves documentaires réelles d'un ensemble de
// Points — memberships HARD/actifs → document_extraction_proposal (même chemin que
// loadTrackedPointReadModel, selectEligibleProposalIds réutilisé tel quel). Requête séparée du
// read-model partagé : n'élargit pas PointReadModelEntry (consommé par la fiche sujet/Debrief,
// hors périmètre de ce lot). Aucune date résolue → sourcePage/effectiveDate à null, jamais une
// date fabriquée. Plafonné à PROOF_DISPLAY_CAP par Point ; totalCount reste le compte réel non
// tronqué pour permettre "Voir N autres" côté UI.
async function loadPointProofsByPointId(
  db: ReturnType<typeof createAdminClient>,
  pointIds: string[],
): Promise<Map<string, { proofs: PointProofView[]; totalCount: number }>> {
  const result = new Map<string, { proofs: PointProofView[]; totalCount: number }>()
  if (pointIds.length === 0) return result

  const { data: memberRows, error: memberErr } = await db
    .from('tracked_point_member')
    .select('tracked_point_id, subject_thread_id, scope, proposal_ids')
    .in('tracked_point_id', pointIds)
    .eq('status', 'active')
    .eq('evidence_grade', 'HARD')
  if (memberErr) throw memberErr

  const membersByPoint = new Map<string, PointMembershipRow[]>()
  for (const row of memberRows ?? []) {
    const list = membersByPoint.get(row.tracked_point_id) ?? []
    list.push({
      subjectThreadId: row.subject_thread_id,
      scope: (row.scope ?? 'thread') as PointMembershipRow['scope'],
      proposalIds: row.proposal_ids,
      status: 'active',
    })
    membersByPoint.set(row.tracked_point_id, list)
  }

  const allThreadIds = [
    ...new Set((memberRows ?? []).filter((r) => (r.scope ?? 'thread') === 'thread').map((r) => r.subject_thread_id)),
  ]
  const allExplicitProposalIds = [
    ...new Set((memberRows ?? []).filter((r) => r.scope === 'proposal_set').flatMap((r) => r.proposal_ids ?? [])),
  ]

  type ProofProposalRow = {
    id: string
    subject_thread_id: string | null
    label: string
    source_excerpt: string | null
    source_page: number | null
    document_id: string
  }

  const [threadResult, explicitResult] = await Promise.all([
    db
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, label, source_excerpt, source_page, document_id')
      .in('subject_thread_id', allThreadIds.length > 0 ? allThreadIds : [NIL_UUID]),
    db
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, label, source_excerpt, source_page, document_id')
      .in('id', allExplicitProposalIds.length > 0 ? allExplicitProposalIds : [NIL_UUID]),
  ])
  if (threadResult.error) throw threadResult.error
  if (explicitResult.error) throw explicitResult.error
  const threadProposals = (threadResult.data ?? []) as ProofProposalRow[]
  const explicitProposals = (explicitResult.data ?? []) as ProofProposalRow[]

  const proposalsByThread = new Map<string, string[]>()
  for (const row of threadProposals) {
    if (!row.subject_thread_id) continue
    const list = proposalsByThread.get(row.subject_thread_id) ?? []
    list.push(row.id)
    proposalsByThread.set(row.subject_thread_id, list)
  }

  const proposalById = new Map<string, ProofProposalRow>()
  for (const row of [...threadProposals, ...explicitProposals]) proposalById.set(row.id, row)

  const docIds = [...new Set([...proposalById.values()].map((p) => p.document_id))]
  const { data: docRows, error: docErr } = await db
    .from('documents')
    .select('id, filename, document_type, effective_date')
    .in('id', docIds.length > 0 ? docIds : [NIL_UUID])
  if (docErr) throw docErr
  const docById = new Map((docRows ?? []).map((d) => [d.id, d]))

  for (const pointId of pointIds) {
    const members = membersByPoint.get(pointId) ?? []
    const eligibleProposalIds = selectEligibleProposalIds(members, proposalsByThread)
    const allProofs: PointProofView[] = [...eligibleProposalIds]
      .map((id) => proposalById.get(id))
      .filter((p): p is ProofProposalRow => p !== undefined)
      .map((p) => {
        const doc = docById.get(p.document_id)
        const excerpt = p.source_excerpt?.trim() || null
        return {
          proposalId: p.id,
          documentId: p.document_id,
          documentFilename: doc?.filename ?? null,
          documentType: doc?.document_type ?? null,
          effectiveDate: doc?.effective_date ?? null,
          sourcePage: p.source_page,
          sourceExcerpt: excerpt,
          extractedLabel: p.label,
          hasVerbatimExcerpt: excerpt !== null,
          provenanceKind: 'hard_membership' as const,
        }
      })
      .sort((a, b) => (b.effectiveDate ?? '').localeCompare(a.effectiveDate ?? ''))

    result.set(pointId, { proofs: allProofs.slice(0, PROOF_DISPLAY_CAP), totalCount: allProofs.length })
  }

  return result
}

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

  // Enrichissement 6E.4A.2 (dates métier, sujet, dernière activité) : chargeur SÉPARÉ de
  // loadTrackedPointConsolidationData (partagé avec consolidateTrackedPoints/rejectPointIdentityPair,
  // jamais touché) — simple merge par id, aucune écriture, aucune reconstruction de la vérité 6B.
  const { points: pointReadModelEntries } = await loadTrackedPointReadModel(siteId)
  const readModelByPointId = new Map(pointReadModelEntries.map((p) => [p.id, p]))

  const subjectIds = [
    ...new Set(pointReadModelEntries.map((p) => p.ownerCanonicalSubjectId).filter((id): id is string => !!id)),
  ]
  const subjectLabelBySubjectId = new Map<string, string | null>()
  if (subjectIds.length > 0) {
    const { data: rawSubjects, error: subjErr } = await db
      .from('canonical_subject')
      .select('id, label')
      .in('id', subjectIds)
    if (subjErr) throw subjErr
    for (const s of rawSubjects ?? []) subjectLabelBySubjectId.set(s.id, s.label)
  }

  const proofsByPointId = await loadPointProofsByPointId(db, pointIds)

  return buildConsolidationQueue(
    siteId,
    pairs,
    pointDetailsById,
    cboCountByPointId,
    hardMemberCountByPointId,
    readModelByPointId,
    subjectLabelBySubjectId,
    proofsByPointId,
  )
}
