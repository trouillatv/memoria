// Phase 6E.1B — étape 2/4 : préflight READ-ONLY complet + simulation du résultat de fusion.
// Aucune écriture. Reproduit EXACTEMENT le pipeline d'agrégation de loadTrackedPointReadModel
// (tracked-point-read-model.ts) sur des données réelles RUS, mais sur un graphe de Points
// PATCHÉ EN MÉMOIRE (jamais en base) où A.status='merged', A.merged_into_id=B — pour observer
// le PointReadModelEntry canonique que produirait la fusion, sans jamais écrire une ligne.
//
// Si la simulation révèle un résultat incohérent (conflict/derivedState/trajectoire imprévus,
// erreur du reducer, composante mal formée) : abort=true dans le rapport, et 6E.1B s'arrête là.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildPointMergeComponents,
  resolveCanonicalPointId,
  deriveCandidatePointPairs,
  type MergeGraphPoint,
  type CandidatePairPointRow,
  type CandidatePairMemberRow,
  type CandidatePairIdentityCandidateRow,
} from '@/lib/knowledge/tracked-point-merge'
import {
  projectTrackedPoint,
  selectEligibleProposalIds,
  assemblePointDocumentaryEvents,
  type TrackedPointRow,
  type PointMembershipRow,
  type PointDocProposalProvenance,
} from '@/lib/knowledge/tracked-point-read-model'
import type { PointCboMember, PointLifecycleEvent } from '@/lib/knowledge/tracked-point-lifecycle-reducer'
import { loadCboReducedStates, loadNonActionCboReducedStates } from '@/lib/knowledge/canonical-business-object-evolution'

const RUS_SITE_ID = 'bebcdf12-fec0-44d8-858b-249ddea02db4'
const POINT_A_ID = 'fc35e0d1-8acc-4748-9fee-7a5b16f9db02' // "Transmettre le listing et le plan des extincteurs"
const POINT_B_ID = '70deb7d1-28bc-4d28-ac76-de464b6855de' // "Listing et plan des extincteurs à transmettre" — cible canonique (step 1)

const FETCH_CHUNK_SIZE = 100

async function fetchAllChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  if (ids.length === 0) return []
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += FETCH_CHUNK_SIZE) chunks.push(ids.slice(i, i + FETCH_CHUNK_SIZE))
  const results = await Promise.all(chunks.map(fetchChunk))
  return results.flat()
}

async function main() {
  const db = createAdminClient()
  const reasons: string[] = []

  // ── 1. Chargement RUS complet (mêmes tables/colonnes que loadTrackedPointReadModel) ──
  const { data: rawPoints, error: pointsErr } = await db
    .from('tracked_point')
    .select('id, site_id, canonical_subject_id, label, status, merged_into_id, identity_status, founding_kind, founding_source, founding_reference, has_upstream_defect, created_at')
    .eq('site_id', RUS_SITE_ID)
  if (pointsErr) throw pointsErr
  if (!rawPoints || rawPoints.length === 0) throw new Error('aucun tracked_point RUS — inattendu')

  const points: TrackedPointRow[] = rawPoints.map((r) => ({
    id: r.id, siteId: r.site_id, canonicalSubjectId: r.canonical_subject_id, label: r.label,
    status: r.status, mergedIntoId: r.merged_into_id, identityStatus: r.identity_status,
    foundingKind: r.founding_kind, foundingSource: r.founding_source, foundingReference: r.founding_reference,
    hasUpstreamDefect: r.has_upstream_defect, createdAt: r.created_at,
  }))
  const pointIds = points.map((p) => p.id)
  const pointsById = new Map(points.map((p) => [p.id, p]))

  const pointA = pointsById.get(POINT_A_ID)
  const pointB = pointsById.get(POINT_B_ID)
  if (!pointA || !pointB) throw new Error('Point A ou B introuvable dans le chargement RUS actuel')

  // ── 2. Re-vérification live des 7 conditions (idempotent avec l'étape 1) ──
  if (pointA.status !== 'active') reasons.push(`Point A status=${pointA.status} (attendu active)`)
  if (pointB.status !== 'active') reasons.push(`Point B status=${pointB.status} (attendu active)`)
  if (pointA.mergedIntoId !== null) reasons.push('Point A a déjà un merged_into_id')
  if (pointB.mergedIntoId !== null) reasons.push('Point B a déjà un merged_into_id')
  if (pointA.identityStatus === 'CONFLICTED') reasons.push('Point A CONFLICTED')
  if (pointB.identityStatus === 'CONFLICTED') reasons.push('Point B CONFLICTED')
  if (pointA.siteId !== pointB.siteId) reasons.push('sites différents')

  const memberRows = await fetchAllChunks<{ tracked_point_id: string; subject_thread_id: string; scope: 'thread' | 'proposal_set' | null; proposal_ids: string[] | null }>(
    pointIds,
    async (chunk) => {
      const { data, error } = await db
        .from('tracked_point_member')
        .select('tracked_point_id, subject_thread_id, scope, proposal_ids')
        .in('tracked_point_id', chunk)
        .eq('status', 'active')
        .eq('evidence_grade', 'HARD')
      if (error) throw error
      return data ?? []
    },
  )

  const threadsByPoint = new Map<string, string[]>()
  const membersByPoint = new Map<string, PointMembershipRow[]>()
  for (const row of memberRows) {
    const list = threadsByPoint.get(row.tracked_point_id) ?? []
    list.push(row.subject_thread_id)
    threadsByPoint.set(row.tracked_point_id, list)
    const members = membersByPoint.get(row.tracked_point_id) ?? []
    members.push({ subjectThreadId: row.subject_thread_id, scope: (row.scope ?? 'thread') as PointMembershipRow['scope'], proposalIds: row.proposal_ids, status: 'active' })
    membersByPoint.set(row.tracked_point_id, members)
  }

  const allThreadIds = [...new Set(memberRows.filter((r) => (r.scope ?? 'thread') === 'thread').map((r) => r.subject_thread_id))]
  const allExplicitProposalIds = [...new Set(memberRows.filter((r) => r.scope === 'proposal_set').flatMap((r) => r.proposal_ids ?? []))]

  type ProposalRow = { id: string; subject_thread_id: string | null; proposal_family: string; document_status: string | null; document_id: string }
  const threadProposalRows = await fetchAllChunks<ProposalRow>(allThreadIds, async (chunk) => {
    const { data, error } = await db.from('document_extraction_proposal').select('id, subject_thread_id, proposal_family, document_status, document_id').in('subject_thread_id', chunk)
    if (error) throw error
    return data ?? []
  })
  const explicitProposalRows = await fetchAllChunks<ProposalRow>(allExplicitProposalIds, async (chunk) => {
    const { data, error } = await db.from('document_extraction_proposal').select('id, subject_thread_id, proposal_family, document_status, document_id').in('id', chunk)
    if (error) throw error
    return data ?? []
  })

  const proposalsByThread = new Map<string, string[]>()
  for (const row of threadProposalRows) {
    if (!row.subject_thread_id) continue
    const list = proposalsByThread.get(row.subject_thread_id) ?? []
    list.push(row.id)
    proposalsByThread.set(row.subject_thread_id, list)
  }
  const proposalById = new Map<string, ProposalRow>()
  for (const row of [...threadProposalRows, ...explicitProposalRows]) proposalById.set(row.id, row)

  const docIds = [...new Set([...proposalById.values()].map((p) => p.document_id))]
  const docDate = new Map<string, string | null>()
  const docRows = await fetchAllChunks<{ id: string; effective_date: string | null }>(docIds, async (chunk) => {
    const { data, error } = await db.from('documents').select('id, effective_date').in('id', chunk)
    if (error) throw error
    return data ?? []
  })
  for (const d of docRows) docDate.set(d.id, d.effective_date)

  const cboRows = await fetchAllChunks<{ id: string; tracked_point_id: string | null }>(pointIds, async (chunk) => {
    const { data, error } = await db.from('canonical_business_object').select('id, tracked_point_id').in('tracked_point_id', chunk)
    if (error) throw error
    return data ?? []
  })
  const cboIdsByPoint = new Map<string, string[]>()
  for (const row of cboRows) {
    if (!row.tracked_point_id) continue
    const list = cboIdsByPoint.get(row.tracked_point_id) ?? []
    list.push(row.id)
    cboIdsByPoint.set(row.tracked_point_id, list)
  }

  const [cboReducedAction, cboReducedNonAction] = await Promise.all([loadCboReducedStates(RUS_SITE_ID), loadNonActionCboReducedStates(RUS_SITE_ID)])
  const cboReduced = new Map([...cboReducedAction, ...cboReducedNonAction])

  function buildEvidenceForPointIds(memberPointIds: string[]): { cboMembers: PointCboMember[]; hardMemberThreadIds: string[]; docs: PointLifecycleEvent[] } {
    const cboIds = [...new Set(memberPointIds.flatMap((id) => cboIdsByPoint.get(id) ?? []))]
    const cboMembers: PointCboMember[] = cboIds
      .map((cboId) => {
        const entry = cboReduced.get(cboId)
        return entry ? { cboId, reduced: entry.reduced } : null
      })
      .filter((m): m is PointCboMember => m !== null)
    const hardMemberThreadIds = [...new Set(memberPointIds.flatMap((id) => threadsByPoint.get(id) ?? []))]
    const members = memberPointIds.flatMap((id) => membersByPoint.get(id) ?? [])
    const eligibleProposalIds = selectEligibleProposalIds(members, proposalsByThread)
    const provenance: PointDocProposalProvenance[] = [...eligibleProposalIds]
      .map((id) => proposalById.get(id))
      .filter((p): p is ProposalRow => p !== undefined)
      .map((p) => ({ proposalId: p.id, proposalFamily: p.proposal_family, documentStatus: p.document_status, date: docDate.get(p.document_id) ?? null }))
    const docs = assemblePointDocumentaryEvents(provenance)
    return { cboMembers, hardMemberThreadIds, docs }
  }

  // ── 3. État ACTUEL (avant fusion) de A et B individuellement ──
  const evidenceA_before = buildEvidenceForPointIds([pointA.id])
  const evidenceB_before = buildEvidenceForPointIds([pointB.id])
  const entryA_before = projectTrackedPoint(pointA, evidenceA_before.cboMembers, evidenceA_before.hardMemberThreadIds, [], evidenceA_before.docs, pointA.id)
  const entryB_before = projectTrackedPoint(pointB, evidenceB_before.cboMembers, evidenceB_before.hardMemberThreadIds, [], evidenceB_before.docs, pointB.id)

  // candidates A→B / B→A (préflight demandé explicitement)
  const { data: rawCandidates, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, site_id, candidate_point_id, subject_thread_id, status')
    .eq('site_id', RUS_SITE_ID)
  if (candErr) throw candErr

  const candidatePairPoints: CandidatePairPointRow[] = points.map((p) => ({ id: p.id, siteId: p.siteId, status: p.status, mergedIntoId: p.mergedIntoId, foundingKind: p.foundingKind, foundingReference: p.foundingReference }))
  const candidatePairMembers: CandidatePairMemberRow[] = memberRows.map((m) => ({ trackedPointId: m.tracked_point_id, subjectThreadId: m.subject_thread_id, scope: (m.scope ?? 'thread') as CandidatePairMemberRow['scope'], status: 'active' }))
  const candidatePairCandidates: CandidatePairIdentityCandidateRow[] = (rawCandidates ?? []).map((c) => ({ id: c.id, siteId: c.site_id, candidatePointId: c.candidate_point_id, subjectThreadId: c.subject_thread_id, status: c.status as CandidatePairIdentityCandidateRow['status'] }))

  const pairsBefore = deriveCandidatePointPairs(candidatePairPoints, candidatePairMembers, candidatePairCandidates)
  const pairsTouchingAOrB_before = pairsBefore.filter((p) => p.pointAId === pointA.id || p.pointBId === pointA.id || p.pointAId === pointB.id || p.pointBId === pointB.id)

  const mergeGraphPointsBefore: MergeGraphPoint[] = points.map((p) => ({ id: p.id, siteId: p.siteId, status: p.status, mergedIntoId: p.mergedIntoId, identityStatus: p.identityStatus, createdAt: p.createdAt }))
  const componentsBefore = buildPointMergeComponents(mergeGraphPointsBefore)
  const componentSizeBefore = (componentsBefore.get(pointA.id)?.memberPointIds.length ?? 0)

  // ── 4. SIMULATION : patch en mémoire A.status='merged', A.merged_into_id=B — 0 écriture ──
  const simulatedPoints: TrackedPointRow[] = points.map((p) => (p.id === pointA.id ? { ...p, status: 'merged', mergedIntoId: pointB.id } : p))
  const simulatedPointsById = new Map(simulatedPoints.map((p) => [p.id, p]))
  const simulatedMergeGraphPoints: MergeGraphPoint[] = simulatedPoints.map((p) => ({ id: p.id, siteId: p.siteId, status: p.status, mergedIntoId: p.mergedIntoId, identityStatus: p.identityStatus, createdAt: p.createdAt }))

  let simulationError: string | null = null
  let simulatedCanonicalEntry: ReturnType<typeof projectTrackedPoint> | null = null
  let simulatedMergedEntryForA: ReturnType<typeof projectTrackedPoint> | null = null
  let simulatedComponentMemberIds: string[] = []
  let pairsAfter: ReturnType<typeof deriveCandidatePointPairs> = []
  let pairsTouchingAOrB_after: ReturnType<typeof deriveCandidatePointPairs> = []

  try {
    const simulatedComponents = buildPointMergeComponents(simulatedMergeGraphPoints)
    const canonicalComponent = simulatedComponents.get(pointB.id)
    if (!canonicalComponent) throw new Error('composante canonique B introuvable après simulation')
    simulatedComponentMemberIds = canonicalComponent.memberPointIds

    const canonicalPointIdForA = resolveCanonicalPointId(pointA.id, simulatedPointsById)
    if (canonicalPointIdForA !== pointB.id) throw new Error(`resolveCanonicalPointId(A) = ${canonicalPointIdForA}, attendu ${pointB.id}`)

    const evidenceCanonical = buildEvidenceForPointIds(simulatedComponentMemberIds)
    simulatedCanonicalEntry = projectTrackedPoint(pointB, evidenceCanonical.cboMembers, evidenceCanonical.hardMemberThreadIds, [], evidenceCanonical.docs, pointB.id)

    const simulatedPointARow = simulatedPointsById.get(pointA.id)!
    const evidenceA_merged = buildEvidenceForPointIds([pointA.id])
    simulatedMergedEntryForA = projectTrackedPoint(simulatedPointARow, evidenceA_merged.cboMembers, evidenceA_merged.hardMemberThreadIds, [], evidenceA_merged.docs, pointB.id)

    const simulatedCandidatePairPoints: CandidatePairPointRow[] = simulatedPoints.map((p) => ({ id: p.id, siteId: p.siteId, status: p.status, mergedIntoId: p.mergedIntoId, foundingKind: p.foundingKind, foundingReference: p.foundingReference }))
    pairsAfter = deriveCandidatePointPairs(simulatedCandidatePairPoints, candidatePairMembers, candidatePairCandidates)
    pairsTouchingAOrB_after = pairsAfter.filter((p) => p.pointAId === pointB.id || p.pointBId === pointB.id)
  } catch (e) {
    simulationError = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
  }

  // ── 5. Verdict de cohérence ──
  if (simulationError) reasons.push(`simulation error: ${simulationError}`)
  if (simulatedComponentMemberIds.length !== 2) reasons.push(`composante simulée taille=${simulatedComponentMemberIds.length} (attendu 2)`)
  if (simulatedComponentMemberIds.length === 2 && (!simulatedComponentMemberIds.includes(pointA.id) || !simulatedComponentMemberIds.includes(pointB.id))) {
    reasons.push('composante simulée ne contient pas exactement {A,B}')
  }
  const selfPairStillPresent = pairsAfter.some((p) => (p.pointAId === pointA.id || p.pointBId === pointA.id))
  if (selfPairStillPresent) reasons.push('A apparaît encore dans une paire après simulation (canonicalisation incomplète)')
  if (simulatedCanonicalEntry && simulatedCanonicalEntry.hasConflict) reasons.push('simulatedCanonicalEntry.hasConflict=true — à examiner avant écriture')

  const abort = reasons.length > 0

  const report = {
    mandate: 'Phase 6E.1B étape 2/4 — préflight + simulation READ-ONLY (0 écriture)',
    generatedAt: new Date().toISOString(),
    pair: { pointAId: pointA.id, pointBId: pointB.id, canonicalTargetId: pointB.id },
    before: {
      pointA: { row: pointA, entry: entryA_before },
      pointB: { row: pointB, entry: entryB_before },
      componentSize: componentSizeBefore,
      pairsTouchingAOrB: pairsTouchingAOrB_before,
    },
    simulatedAfter: {
      canonicalEntry: simulatedCanonicalEntry,
      mergedEntryForA: simulatedMergedEntryForA,
      componentMemberIds: simulatedComponentMemberIds,
      pairsTouchingCanonical: pairsTouchingAOrB_after,
      selfPairStillPresent,
      simulationError,
    },
    verdict: { abort, reasons },
  }

  writeFileSync('scripts/_p6e1b-02-simulate-merge-report.json', JSON.stringify(report, null, 2))

  console.log('=== Avant (A) ===')
  console.log({ id: entryA_before.id, status: entryA_before.status, derivedState: entryA_before.derivedState, cboIds: entryA_before.cboIds, hardMemberThreadIds: entryA_before.hardMemberThreadIds, hasConflict: entryA_before.hasConflict, hasDocumentaryDivergence: entryA_before.hasDocumentaryDivergence })
  console.log('=== Avant (B) ===')
  console.log({ id: entryB_before.id, status: entryB_before.status, derivedState: entryB_before.derivedState, cboIds: entryB_before.cboIds, hardMemberThreadIds: entryB_before.hardMemberThreadIds, hasConflict: entryB_before.hasConflict, hasDocumentaryDivergence: entryB_before.hasDocumentaryDivergence })
  console.log(`componentSize avant = ${componentSizeBefore} ; paires touchant A ou B avant =`, pairsTouchingAOrB_before.map((p) => p.pairKey))

  console.log('\n=== Simulation (après fusion A→B, EN MÉMOIRE UNIQUEMENT) ===')
  if (simulationError) {
    console.log(`ERREUR DE SIMULATION : ${simulationError}`)
  } else {
    console.log({ canonicalId: pointB.id, derivedState: simulatedCanonicalEntry?.derivedState, cboIds: simulatedCanonicalEntry?.cboIds, hardMemberThreadIds: simulatedCanonicalEntry?.hardMemberThreadIds, hasConflict: simulatedCanonicalEntry?.hasConflict, hasDocumentaryDivergence: simulatedCanonicalEntry?.hasDocumentaryDivergence, markers: simulatedCanonicalEntry?.markers })
    console.log(`composante simulée =`, simulatedComponentMemberIds)
    console.log(`paires touchant le canonique après simulation =`, pairsTouchingAOrB_after.map((p) => p.pairKey), `(self-pair A↔B toujours présente = ${selfPairStillPresent})`)
  }

  console.log(`\n=== VERDICT === abort=${abort}`)
  if (abort) console.log('raisons:', reasons)

  console.log('\nRapport écrit : scripts/_p6e1b-02-simulate-merge-report.json')
  console.log('=== HARD STOP — 0 écriture ===')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
