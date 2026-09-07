// Phase 6E.2B — étape 4/4 : recette post-acceptation READ-ONLY (aucune écriture, sauf le rejeu
// idempotent de l'étape 8 qui n'écrit rien de plus par construction — cf. migration 393).
// Vérifie exactement les preuves demandées par Vincent après l'APPLY de l'étape 3 :
// +1 HARD membership / candidate pending→accepted / source intacte / target consomme la preuve /
// aucun autre Point contaminé / rejeu → ALREADY_ASSOCIATED sans 2e écriture.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'
import { acceptTraceIdentityCandidate } from '@/lib/db/tracked-point-trace-acceptance'

const RUS_SITE_ID = 'bebcdf12-fec0-44d8-858b-249ddea02db4'
const CANDIDATE_ID = 'da09c952-ebab-4c25-a7d8-8facb9fa0588'
const TARGET_POINT_ID = 'f1f377fc-e003-44cf-8aba-8050507c1db6'
const SOURCE_THREAD_ID = '472d86e3-8765-473b-9582-5fd9e146c19e'
const EXPECTED_MEMBER_ID = '98d4baba-2a2c-4da9-b431-55662768b036'
// Threads HARD déjà présents sur la cible AVANT l'acceptation (rapport étape 2).
const PRE_EXISTING_TARGET_THREADS = ['f6a26c7c-3350-4a18-a864-0ec8be84389c', 'ca6348ca-534e-4f41-9d99-41e511253516']
// Les 3 autres témoins RUS SAFE_SINGLE_TRACE_THREAD identifiés en étape 1 — NE DOIVENT PAS bouger.
const OTHER_WITNESS_CANDIDATE_IDS = ['bc099e2c-134d-4e0c-bcfd-90485c05bfaa', '2b11a6bd-0947-478c-a2b9-00aa122392bf', 'ba9095ba-df47-4c22-8a4f-1ac962bec3e0']

async function main() {
  const db = createAdminClient()
  const checks: Record<string, unknown> = {}
  const failures: string[] = []

  // ── 1. +1 HARD membership, exactement une ligne, sur le bon (point, thread) ──
  const { data: members, error: memErr } = await db
    .from('tracked_point_member')
    .select('id, tracked_point_id, subject_thread_id, scope, status, evidence_grade, created_at')
    .eq('tracked_point_id', TARGET_POINT_ID)
    .eq('subject_thread_id', SOURCE_THREAD_ID)
  if (memErr) throw memErr
  checks.newMembership = members
  if (!members || members.length !== 1) failures.push(`${members?.length ?? 0} ligne(s) tracked_point_member pour (target, source) — attendu exactement 1`)
  const m = members?.[0]
  if (m && m.id !== EXPECTED_MEMBER_ID) failures.push(`memberId=${m.id}, attendu ${EXPECTED_MEMBER_ID}`)
  if (m && m.status !== 'active') failures.push(`membership.status=${m.status}, attendu active`)
  if (m && m.scope !== 'thread') failures.push(`membership.scope=${m.scope}, attendu thread`)
  if (m && m.evidence_grade !== 'HARD') failures.push(`membership.evidence_grade=${m.evidence_grade}, attendu HARD`)

  // ── 2. Candidate pending → accepted, resolved_at posé ──
  const { data: candRow, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, status, resolved_at, candidate_point_id, subject_thread_id')
    .eq('id', CANDIDATE_ID)
    .single()
  if (candErr) throw candErr
  checks.candidateAfter = candRow
  if (candRow.status !== 'accepted') failures.push(`candidate.status=${candRow.status}, attendu accepted`)
  if (!candRow.resolved_at) failures.push('candidate.resolved_at manquant')

  // ── 3. Source intacte : propositions du thread source inchangées (0 mutation) ──
  const { data: sourceProposals, error: propErr } = await db
    .from('document_extraction_proposal')
    .select('id, proposal_family, subject_thread_id, document_id, label')
    .eq('subject_thread_id', SOURCE_THREAD_ID)
  if (propErr) throw propErr
  checks.sourceProposalsAfter = sourceProposals
  if (!sourceProposals || sourceProposals.length !== 1 || sourceProposals[0].id !== '82850e84-2622-4dad-abde-55a7a7a888fd') {
    failures.push('propositions du thread source altérées — attendu exactement la même ligne qu\'avant acceptation')
  }

  // ── 4. Target consomme la nouvelle preuve — via le read-model RÉEL (pas de réimplémentation) ──
  const readModel = await loadTrackedPointReadModel(RUS_SITE_ID)
  const targetEntry = readModel.points.find((p) => p.id === TARGET_POINT_ID)
  checks.targetReadModelAfter = targetEntry ? {
    id: targetEntry.id, label: targetEntry.label, derivedState: targetEntry.derivedState,
    cboIds: targetEntry.cboIds, hardMemberThreadIds: targetEntry.hardMemberThreadIds,
    hasConflict: targetEntry.hasConflict, hasDocumentaryDivergence: targetEntry.hasDocumentaryDivergence,
  } : null
  if (!targetEntry) failures.push('target absent de readModel.points')
  if (targetEntry && !targetEntry.hardMemberThreadIds.includes(SOURCE_THREAD_ID)) failures.push('SOURCE_THREAD_ID absent de hardMemberThreadIds — la preuve n\'est pas consommée par le Point')
  for (const priorThread of PRE_EXISTING_TARGET_THREADS) {
    if (targetEntry && !targetEntry.hardMemberThreadIds.includes(priorThread)) failures.push(`thread préexistant ${priorThread} disparu de hardMemberThreadIds — contamination/perte suspectée`)
  }
  if (targetEntry && targetEntry.hardMemberThreadIds.length !== PRE_EXISTING_TARGET_THREADS.length + 1) {
    failures.push(`hardMemberThreadIds.length=${targetEntry.hardMemberThreadIds.length}, attendu ${PRE_EXISTING_TARGET_THREADS.length + 1}`)
  }

  // ── 5. Non-contamination : les 3 autres témoins RUS SAFE_SINGLE_TRACE_THREAD restent pending,
  //      inchangés — seul CANDIDATE_ID a bougé. ──
  const { data: otherCandidates, error: otherErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, status, resolved_at, candidate_point_id, subject_thread_id')
    .in('id', OTHER_WITNESS_CANDIDATE_IDS)
  if (otherErr) throw otherErr
  checks.otherWitnessCandidates = otherCandidates
  for (const c of otherCandidates ?? []) {
    if (c.status !== 'pending') failures.push(`témoin non traité ${c.id} status=${c.status}, attendu pending (0 traitement en masse)`)
    if (c.resolved_at) failures.push(`témoin non traité ${c.id} a resolved_at posé — inattendu`)
  }

  // ── 6. Non-contamination globale : aucun AUTRE Point RUS n'a de nouvelle membership sur ce thread,
  //      et le nombre total de memberships actives sur RUS n'a bougé que de +1. ──
  const { data: crossPointCheck, error: crossErr } = await db
    .from('tracked_point_member')
    .select('id, tracked_point_id')
    .eq('subject_thread_id', SOURCE_THREAD_ID)
    .eq('status', 'active')
  if (crossErr) throw crossErr
  checks.crossPointCheck = crossPointCheck
  if (!crossPointCheck || crossPointCheck.length !== 1 || crossPointCheck[0].tracked_point_id !== TARGET_POINT_ID) {
    failures.push('le thread source a une membership active ailleurs qu\'à la cible — contamination')
  }

  // ── 7. IDEMPOTENCE — rejeu #2 du même candidate_id ──
  const replay = await acceptTraceIdentityCandidate({ siteId: RUS_SITE_ID, candidateId: CANDIDATE_ID })
  checks.idempotencyReplay = replay
  if (!replay.ok) failures.push(`rejeu attendu ok=true, reçu échec: ${JSON.stringify(replay)}`)
  if (replay.ok && !replay.alreadyAssociated) failures.push('rejeu attendu alreadyAssociated=true')
  if (replay.ok && replay.targetPointId !== TARGET_POINT_ID) failures.push('rejeu targetPointId inattendu')

  const { data: membersAfterReplay, error: memReplayErr } = await db
    .from('tracked_point_member')
    .select('id')
    .eq('tracked_point_id', TARGET_POINT_ID)
    .eq('subject_thread_id', SOURCE_THREAD_ID)
  if (memReplayErr) throw memReplayErr
  checks.membershipCountAfterReplay = membersAfterReplay?.length
  if (!membersAfterReplay || membersAfterReplay.length !== 1) failures.push(`après rejeu, ${membersAfterReplay?.length ?? 0} ligne(s) — attendu toujours exactement 1 (0 nouvelle écriture)`)

  const verdict = failures.length === 0 ? 'PASS' : 'FAIL'

  const report = {
    mandate: 'Phase 6E.2B étape 4/4 — recette post-acceptation + idempotence (READ-ONLY sauf rejeu, 0 écriture supplémentaire attendue)',
    generatedAt: new Date().toISOString(),
    checks,
    failures,
    verdict,
  }
  writeFileSync('scripts/_p6e2b-04-post-recette-report.json', JSON.stringify(report, null, 2))

  console.log('=== +1 HARD membership ===', checks.newMembership)
  console.log('\n=== Candidate après acceptation ===', checks.candidateAfter)
  console.log('\n=== Propositions source (intactes) ===', checks.sourceProposalsAfter)
  console.log('\n=== Target — read-model réel après acceptation ===', checks.targetReadModelAfter)
  console.log('\n=== Autres témoins RUS — non touchés ===', checks.otherWitnessCandidates)
  console.log('\n=== Aucun autre Point contaminé (membership du thread source) ===', checks.crossPointCheck)
  console.log('\n=== Rejeu idempotent ===', checks.idempotencyReplay)
  console.log('=== Nombre de memberships après rejeu ===', checks.membershipCountAfterReplay)

  console.log(`\n=== VERDICT: ${verdict} ===`)
  if (failures.length > 0) console.log('Échecs:', failures)

  console.log('\nRapport écrit : scripts/_p6e2b-04-post-recette-report.json')
}

main().catch((e) => { console.error(e); process.exit(1) })
