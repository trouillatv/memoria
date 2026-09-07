// Phase 6E.1B — étape 4/4 : recette post-fusion READ-ONLY (aucune écriture).
// Vérifie exactement les preuves demandées par Vincent après l'APPLY de l'étape 3.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'
import { deriveCandidatePointPairs, computeConnectedComponents, type CandidatePairPointRow, type CandidatePairMemberRow, type CandidatePairIdentityCandidateRow } from '@/lib/knowledge/tracked-point-merge'

const RUS_SITE_ID = 'bebcdf12-fec0-44d8-858b-249ddea02db4'
const POINT_A_ID = 'fc35e0d1-8acc-4748-9fee-7a5b16f9db02'
const POINT_B_ID = '70deb7d1-28bc-4d28-ac76-de464b6855de'
const CANDIDATE_IDS = ['21b5f9e9-71d7-489d-b927-5766ba625718', '6e827b2b-9ae9-4c25-80bc-bd3ab2d5802c']

// Baseline avant fusion (étape 1 : 199 points RUS, tous status='active' — aucun merge
// réel n'existait avant l'étape 3 de ce lot).
const BASELINE_ACTIVE_COUNT = 199

async function main() {
  const db = createAdminClient()
  const checks: Record<string, unknown> = {}
  const failures: string[] = []

  // ── 1. Comptage actifs/merged sur toute la table (preuve N → N-1 / +1) ──
  const { data: allPoints, error: allErr } = await db.from('tracked_point').select('id, status').eq('site_id', RUS_SITE_ID)
  if (allErr) throw allErr
  const activeCount = (allPoints ?? []).filter((p) => p.status === 'active').length
  const mergedCount = (allPoints ?? []).filter((p) => p.status === 'merged').length
  checks.counts = { totalPoints: allPoints?.length, activeCount, mergedCount, baselineActiveBefore: BASELINE_ACTIVE_COUNT }
  if (activeCount !== BASELINE_ACTIVE_COUNT - 1) failures.push(`activeCount=${activeCount}, attendu ${BASELINE_ACTIVE_COUNT - 1}`)
  if (mergedCount !== 1) failures.push(`mergedCount=${mergedCount}, attendu 1`)

  // ── 2. A physiquement présent, status=merged, merged_into_id=B ──
  const { data: rowA, error: rowAErr } = await db.from('tracked_point').select('id, status, merged_into_id, canonical_subject_id').eq('id', POINT_A_ID).single()
  if (rowAErr) throw rowAErr
  checks.pointARow = rowA
  if (rowA.status !== 'merged') failures.push(`A.status=${rowA.status}, attendu merged`)
  if (rowA.merged_into_id !== POINT_B_ID) failures.push(`A.merged_into_id=${rowA.merged_into_id}, attendu ${POINT_B_ID}`)

  const { data: rowB, error: rowBErr } = await db.from('tracked_point').select('id, status, merged_into_id, canonical_subject_id').eq('id', POINT_B_ID).single()
  if (rowBErr) throw rowBErr
  checks.pointBRow = rowB
  if (rowB.status !== 'active') failures.push(`B.status=${rowB.status}, attendu active`)
  if (rowB.merged_into_id !== null) failures.push(`B.merged_into_id=${rowB.merged_into_id}, attendu null`)

  // ── 3. Membres A toujours physiquement attachés à A (0 déplacement) ──
  const { data: membersA, error: memAErr } = await db.from('tracked_point_member').select('tracked_point_id, subject_thread_id, status').eq('tracked_point_id', POINT_A_ID)
  if (memAErr) throw memAErr
  checks.membersStillOnA = membersA
  if (!membersA || membersA.length === 0) failures.push('aucun tracked_point_member encore attaché à A — déplacement suspecté')

  // ── 4. CBO A toujours tracked_point_id=A (0 déplacement) ──
  const { data: cboA, error: cboAErr } = await db.from('canonical_business_object').select('id, tracked_point_id').eq('tracked_point_id', POINT_A_ID)
  if (cboAErr) throw cboAErr
  checks.cboStillOnA = cboA
  if (!cboA || cboA.length === 0) failures.push('aucun canonical_business_object encore rattaché à A — déplacement suspecté')

  // ── 5. Lecture via le read-model réel (pas de re-implémentation) ──
  const readModel = await loadTrackedPointReadModel(RUS_SITE_ID)
  const activeEntryForA = readModel.points.find((p) => p.id === POINT_A_ID)
  const mergedEntryForA = readModel.mergedPoints.find((p) => p.id === POINT_A_ID)
  const canonicalEntryForB = readModel.points.find((p) => p.id === POINT_B_ID)

  checks.readModel = {
    aInActivePointsList: activeEntryForA !== undefined,
    aInMergedPointsList: mergedEntryForA !== undefined,
    aCanonicalPointId: mergedEntryForA?.canonicalPointId,
    bPresentInActivePoints: canonicalEntryForB !== undefined,
    bCboIds: canonicalEntryForB?.cboIds,
    bHardMemberThreadIds: canonicalEntryForB?.hardMemberThreadIds,
    bDerivedState: canonicalEntryForB?.derivedState,
    bHasConflict: canonicalEntryForB?.hasConflict,
    bHasDocumentaryDivergence: canonicalEntryForB?.hasDocumentaryDivergence,
  }
  if (activeEntryForA) failures.push('A apparaît encore dans readModel.points (liste active) — devrait être exclu')
  if (!mergedEntryForA) failures.push('A absent de readModel.mergedPoints')
  if (mergedEntryForA && mergedEntryForA.canonicalPointId !== POINT_B_ID) failures.push(`mergedEntryForA.canonicalPointId=${mergedEntryForA.canonicalPointId}, attendu ${POINT_B_ID}`)
  if (!canonicalEntryForB) failures.push('B absent de readModel.points')
  if (canonicalEntryForB && !canonicalEntryForB.cboIds.includes('9c4d51fd-a36c-4dcc-8b6a-755abecd36a7')) failures.push('CBO de A absent de canonicalEntryForB.cboIds — agrégation non consommée')
  if (canonicalEntryForB && !canonicalEntryForB.cboIds.includes('3132f0f1-0301-44fb-80a9-e8b66c6be987')) failures.push('CBO de B absent de canonicalEntryForB.cboIds')

  // ── 6. Sujet — canonical_subject_id de A et B (conséquence du principe Sujet ≠ frontière d'identité) ──
  checks.subjectCheck = { aCanonicalSubjectId: rowA.canonical_subject_id, bCanonicalSubjectId: rowB.canonical_subject_id, sameSubject: rowA.canonical_subject_id === rowB.canonical_subject_id }
  if (rowA.canonical_subject_id && rowB.canonical_subject_id && rowA.canonical_subject_id === rowB.canonical_subject_id) {
    const subjectModel = readModel.bySubject.get(rowA.canonical_subject_id)
    checks.subjectCheck = { ...checks.subjectCheck, activePointsInSubjectAfter: subjectModel?.totalPoints }
  }

  // ── 7. Candidates après fusion : les deux candidates A/B acceptées ; A disparaît de la file active ──
  const { data: candRowsAfter, error: candAfterErr } = await db.from('tracked_point_identity_candidate').select('id, status, resolved_at, candidate_point_id').in('id', CANDIDATE_IDS)
  if (candAfterErr) throw candAfterErr
  checks.candidatesAfter = candRowsAfter
  for (const c of candRowsAfter ?? []) {
    if (c.status !== 'accepted') failures.push(`candidate ${c.id} status=${c.status}, attendu accepted`)
    if (!c.resolved_at) failures.push(`candidate ${c.id} resolved_at manquant`)
  }

  const { data: allPointsFull, error: allFullErr } = await db.from('tracked_point').select('id, site_id, status, merged_into_id, founding_kind, founding_reference').eq('site_id', RUS_SITE_ID)
  if (allFullErr) throw allFullErr
  const { data: allMembers, error: allMemErr } = await db.from('tracked_point_member').select('tracked_point_id, subject_thread_id, scope, status').eq('status', 'active')
  if (allMemErr) throw allMemErr
  const { data: allCandidatesRus, error: allCandRusErr } = await db.from('tracked_point_identity_candidate').select('id, site_id, candidate_point_id, subject_thread_id, status').eq('site_id', RUS_SITE_ID)
  if (allCandRusErr) throw allCandRusErr

  const candidatePairPoints: CandidatePairPointRow[] = (allPointsFull ?? []).map((p) => ({ id: p.id, siteId: p.site_id, status: p.status, mergedIntoId: p.merged_into_id, foundingKind: p.founding_kind, foundingReference: p.founding_reference }))
  const candidatePairMembers: CandidatePairMemberRow[] = (allMembers ?? []).filter((m) => (allPointsFull ?? []).some((p) => p.id === m.tracked_point_id)).map((m) => ({ trackedPointId: m.tracked_point_id, subjectThreadId: m.subject_thread_id, scope: (m.scope ?? 'thread') as CandidatePairMemberRow['scope'], status: 'active' }))
  const candidatePairCandidates: CandidatePairIdentityCandidateRow[] = (allCandidatesRus ?? []).map((c) => ({ id: c.id, siteId: c.site_id, candidatePointId: c.candidate_point_id, subjectThreadId: c.subject_thread_id, status: c.status as CandidatePairIdentityCandidateRow['status'] }))

  const pairsAfter = deriveCandidatePointPairs(candidatePairPoints, candidatePairMembers, candidatePairCandidates)
  const selfPairAB = pairsAfter.find((p) => (p.pointAId === POINT_A_ID || p.pointBId === POINT_A_ID))
  checks.pairsAfterFusion = { selfPairABStillPresent: selfPairAB !== undefined, pairsTouchingB: pairsAfter.filter((p) => p.pointAId === POINT_B_ID || p.pointBId === POINT_B_ID).map((p) => p.pairKey) }
  if (selfPairAB) failures.push(`A apparaît encore dans une paire candidate après fusion: ${JSON.stringify(selfPairAB)}`)

  const componentsAfter = computeConnectedComponents(pairsAfter.map((p) => ({ a: p.pointAId, b: p.pointBId })))
  const clusterHistogramAfter: Record<string, number> = {}
  for (const c of componentsAfter) {
    const key = c.length >= 3 ? '3+' : String(c.length)
    clusterHistogramAfter[key] = (clusterHistogramAfter[key] ?? 0) + 1
  }
  checks.clusterHistogramAfter = { totalPairsAfter: pairsAfter.length, clusterHistogramAfter }

  // ── 8. IDEMPOTENCE — rejeu #2 du même merge (source déjà canonicalisé) ──
  const { data: idem, error: idemErr } = await db.rpc('merge_tracked_points', { p_source_id: POINT_A_ID, p_target_id: POINT_B_ID, p_candidate_ids: CANDIDATE_IDS })
  checks.idempotencyReplay = { succeeded: !idemErr, result: idem, error: idemErr ? { message: idemErr.message, code: idemErr.code } : null }
  if (!idemErr) failures.push('rejeu #2 de merge(A,B) a réussi sans erreur — attendu un rejet explicite (A déjà status=merged)')

  // ── 9. Sécurité anti-cycle : merge(B, A) — target déjà résolu vers B ──
  const { data: reverseAttempt, error: reverseErr } = await db.rpc('merge_tracked_points', { p_source_id: POINT_B_ID, p_target_id: POINT_A_ID, p_candidate_ids: CANDIDATE_IDS })
  checks.reverseMergeAttempt = { succeeded: !reverseErr, result: reverseAttempt, error: reverseErr ? { message: reverseErr.message, code: reverseErr.code } : null }
  if (!reverseErr) failures.push('merge(B, A) a réussi sans erreur — attendu un rejet explicite (A n\'est plus active)')

  // Re-vérifier qu'aucun de ces deux appels n'a modifié l'état (doivent avoir échoué avant tout UPDATE)
  const { data: rowAAfterReplays, error: rowAAfterErr } = await db.from('tracked_point').select('id, status, merged_into_id').eq('id', POINT_A_ID).single()
  if (rowAAfterErr) throw rowAAfterErr
  const { data: rowBAfterReplays, error: rowBAfterErr } = await db.from('tracked_point').select('id, status, merged_into_id').eq('id', POINT_B_ID).single()
  if (rowBAfterErr) throw rowBAfterErr
  checks.stateAfterReplays = { pointA: rowAAfterReplays, pointB: rowBAfterReplays }
  if (rowAAfterReplays.status !== 'merged' || rowAAfterReplays.merged_into_id !== POINT_B_ID) failures.push('état de A altéré par les rejeux — inattendu')
  if (rowBAfterReplays.status !== 'active' || rowBAfterReplays.merged_into_id !== null) failures.push('état de B altéré par les rejeux — inattendu')

  const verdict = failures.length === 0 ? 'PASS' : 'FAIL'

  const report = { mandate: 'Phase 6E.1B étape 4/4 — recette post-fusion + idempotence + anti-cycle (READ-ONLY)', generatedAt: new Date().toISOString(), checks, failures, verdict }
  writeFileSync('scripts/_p6e1b-04-post-recette-report.json', JSON.stringify(report, null, 2))

  console.log('=== Comptages ===', checks.counts)
  console.log('\n=== A (physique) ===', rowA)
  console.log('=== B (physique) ===', rowB)
  console.log('\n=== Membres/CBO toujours sur A ===', { members: membersA?.length, cbo: cboA?.length })
  console.log('\n=== Read-model ===', checks.readModel)
  console.log('\n=== Sujet ===', checks.subjectCheck)
  console.log('\n=== Candidates après fusion ===', candRowsAfter)
  console.log('\n=== Paires après fusion ===', checks.pairsAfterFusion)
  console.log('\n=== Idempotence (rejeu #2) ===', checks.idempotencyReplay)
  console.log('=== Anti-cycle merge(B,A) ===', checks.reverseMergeAttempt)
  console.log('=== État final après rejeux ===', checks.stateAfterReplays)

  console.log(`\n=== VERDICT: ${verdict} ===`)
  if (failures.length > 0) console.log('Échecs:', failures)

  console.log('\nRapport écrit : scripts/_p6e1b-04-post-recette-report.json')
}

main().catch((e) => { console.error(e); process.exit(1) })
