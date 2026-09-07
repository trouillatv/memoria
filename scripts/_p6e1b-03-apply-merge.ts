// Phase 6E.1B — étape 3/4 : APPLY réel, unique, de la fusion pilote A→B sur RUS.
// Re-vérifie live les 7 conditions (idempotent avec étapes 1/2), puis appelle UNE FOIS
// merge_tracked_points(source, target, candidate_ids) — seule fonction autorisée à écrire
// (migration 391). Aucune autre écriture. ABORT sans appeler la fonction si une condition
// n'est plus vraie au moment de l'exécution.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  chooseCanonicalMergeTarget,
  deriveCandidatePointPairs,
  computeConnectedComponents,
  type MergeGraphPoint,
  type CandidatePairPointRow,
  type CandidatePairMemberRow,
  type CandidatePairIdentityCandidateRow,
} from '@/lib/knowledge/tracked-point-merge'

const RUS_SITE_ID = 'bebcdf12-fec0-44d8-858b-249ddea02db4'
const POINT_A_ID = 'fc35e0d1-8acc-4748-9fee-7a5b16f9db02' // source — "Transmettre le listing et le plan des extincteurs"
const POINT_B_ID = '70deb7d1-28bc-4d28-ac76-de464b6855de' // target canonique — "Listing et plan des extincteurs à transmettre"
const EXPECTED_CANDIDATE_IDS = ['21b5f9e9-71d7-489d-b927-5766ba625718', '6e827b2b-9ae9-4c25-80bc-bd3ab2d5802c']

async function main() {
  const db = createAdminClient()

  const { data: rawPoints, error: pointsErr } = await db
    .from('tracked_point')
    .select('id, site_id, status, merged_into_id, identity_status, created_at, label, founding_kind, founding_reference')
    .eq('site_id', RUS_SITE_ID)
  if (pointsErr) throw pointsErr
  if (!rawPoints) throw new Error('aucun point RUS')

  const pointA = rawPoints.find((p) => p.id === POINT_A_ID)
  const pointB = rawPoints.find((p) => p.id === POINT_B_ID)
  if (!pointA || !pointB) throw new Error('Point A ou B introuvable')

  const reasons: string[] = []
  if (pointA.status !== 'active') reasons.push(`A status=${pointA.status}`)
  if (pointB.status !== 'active') reasons.push(`B status=${pointB.status}`)
  if (pointA.merged_into_id !== null) reasons.push('A a déjà merged_into_id')
  if (pointB.merged_into_id !== null) reasons.push('B a déjà merged_into_id')
  if (pointA.site_id !== pointB.site_id) reasons.push('sites différents')
  if (pointA.identity_status === 'CONFLICTED' || pointB.identity_status === 'CONFLICTED') reasons.push('CONFLICTED présent')

  const mergeGraphPoints: MergeGraphPoint[] = rawPoints.map((p) => ({
    id: p.id, siteId: p.site_id, status: p.status, mergedIntoId: p.merged_into_id,
    identityStatus: p.identity_status, createdAt: p.created_at,
  }))

  // Taille de composante = grappe des PAIRES CANDIDATES (deriveCandidatePointPairs +
  // computeConnectedComponents), exactement comme l'étape 1 — PAS buildPointMergeComponents
  // (qui groupe par chaînes merged_into_id déjà existantes, toujours singleton avant tout merge réel).
  const pointIdsRus = rawPoints.map((p) => p.id)
  const { data: rawMembers, error: memErr } = await db
    .from('tracked_point_member')
    .select('tracked_point_id, subject_thread_id, scope, status')
    .in('tracked_point_id', pointIdsRus)
  if (memErr) throw memErr

  const { data: allCandRows, error: allCandErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, site_id, candidate_point_id, subject_thread_id, status')
    .eq('site_id', RUS_SITE_ID)
  if (allCandErr) throw allCandErr

  const candidatePairPoints: CandidatePairPointRow[] = rawPoints.map((p) => ({
    id: p.id, siteId: p.site_id, status: p.status, mergedIntoId: p.merged_into_id,
    foundingKind: p.founding_kind, foundingReference: p.founding_reference,
  }))
  const candidatePairMembers: CandidatePairMemberRow[] = (rawMembers ?? []).map((m) => ({
    trackedPointId: m.tracked_point_id, subjectThreadId: m.subject_thread_id,
    scope: (m.scope ?? 'thread') as CandidatePairMemberRow['scope'], status: m.status as CandidatePairMemberRow['status'],
  }))
  const candidatePairCandidates: CandidatePairIdentityCandidateRow[] = (allCandRows ?? []).map((c) => ({
    id: c.id, siteId: c.site_id, candidatePointId: c.candidate_point_id,
    subjectThreadId: c.subject_thread_id, status: c.status as CandidatePairIdentityCandidateRow['status'],
  }))

  const pairs = deriveCandidatePointPairs(candidatePairPoints, candidatePairMembers, candidatePairCandidates)
  const pairComponents = computeConnectedComponents(pairs.map((p) => ({ a: p.pointAId, b: p.pointBId })))
  const componentAB = pairComponents.find((c) => c.includes(POINT_A_ID)) ?? [POINT_A_ID]
  const componentSize = componentAB.length
  if (componentSize !== 2 || !componentAB.includes(POINT_B_ID)) {
    reasons.push(`composante candidate=${JSON.stringify(componentAB)} (attendu exactement [A,B])`)
  }

  const aGraph = mergeGraphPoints.find((p) => p.id === POINT_A_ID)!
  const bGraph = mergeGraphPoints.find((p) => p.id === POINT_B_ID)!
  let canonicalTargetId: string | null = null
  try {
    canonicalTargetId = chooseCanonicalMergeTarget(aGraph, bGraph)
  } catch (e) {
    reasons.push(`chooseCanonicalMergeTarget error: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (canonicalTargetId !== POINT_B_ID) reasons.push(`canonicalTargetId=${canonicalTargetId} (attendu ${POINT_B_ID})`)

  const { data: candRows, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, site_id, candidate_point_id, status')
    .in('id', EXPECTED_CANDIDATE_IDS)
  if (candErr) throw candErr
  if (!candRows || candRows.length !== EXPECTED_CANDIDATE_IDS.length) reasons.push('candidate rows attendues introuvables')
  for (const c of candRows ?? []) {
    if (c.status !== 'pending') reasons.push(`candidate ${c.id} status=${c.status} (attendu pending)`)
    if (c.candidate_point_id !== POINT_A_ID && c.candidate_point_id !== POINT_B_ID) reasons.push(`candidate ${c.id} candidate_point_id inattendu`)
  }

  const abort = reasons.length > 0
  console.log('=== Re-vérification live avant APPLY ===')
  console.log({ pointA: { id: pointA.id, status: pointA.status, identity_status: pointA.identity_status }, pointB: { id: pointB.id, status: pointB.status, identity_status: pointB.identity_status }, componentSize, canonicalTargetId, candidateIds: EXPECTED_CANDIDATE_IDS })

  if (abort) {
    console.log('\nABORT — conditions non satisfaites au moment de l\'exécution:', reasons)
    writeFileSync('scripts/_p6e1b-03-apply-merge-report.json', JSON.stringify({ generatedAt: new Date().toISOString(), abort: true, reasons }, null, 2))
    process.exit(1)
  }

  console.log('\nConditions OK — appel unique de merge_tracked_points(source=A, target=B, candidate_ids)...')
  const { data: rpcResult, error: rpcError } = await db.rpc('merge_tracked_points', {
    p_source_id: POINT_A_ID,
    p_target_id: POINT_B_ID,
    p_candidate_ids: EXPECTED_CANDIDATE_IDS,
  })

  if (rpcError) {
    console.log('\nÉCHEC RPC (aucune écriture — transaction annulée par PL/pgSQL) :', rpcError)
    writeFileSync('scripts/_p6e1b-03-apply-merge-report.json', JSON.stringify({ generatedAt: new Date().toISOString(), abort: true, rpcError }, null, 2))
    process.exit(1)
  }

  console.log('\n=== SUCCÈS — fusion appliquée ===')
  console.log(rpcResult)

  writeFileSync('scripts/_p6e1b-03-apply-merge-report.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    abort: false,
    pointAId: POINT_A_ID,
    pointBId: POINT_B_ID,
    candidateIds: EXPECTED_CANDIDATE_IDS,
    rpcResult,
  }, null, 2))

  console.log('\nRapport écrit : scripts/_p6e1b-03-apply-merge-report.json')
  console.log('=== FUSION APPLIQUÉE — 1 écriture transactionnelle, 0 autre ===')
}

main().catch((e) => { console.error(e); process.exit(1) })
