// Phase 6E.2B — étape 3/4 : APPLY réel, unique, de l'acceptation du candidat témoin TRACE_TO_POINT.
// Re-vérifie live les conditions (idempotent avec les étapes 1/2), puis appelle UNE FOIS
// acceptTraceIdentityCandidate (lib/db/tracked-point-trace-acceptance.ts), qui revalide elle-même
// SAFE_SINGLE_TRACE_THREAD live avant d'appeler accept_trace_identity_candidate (migration 393) —
// seule fonction autorisée à écrire. ABORT sans appeler le wrapper si une condition n'est plus vraie.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { acceptTraceIdentityCandidate } from '@/lib/db/tracked-point-trace-acceptance'

const RUS_SITE_ID = 'bebcdf12-fec0-44d8-858b-249ddea02db4'
const CANDIDATE_ID = 'da09c952-ebab-4c25-a7d8-8facb9fa0588'
const TARGET_POINT_ID = 'f1f377fc-e003-44cf-8aba-8050507c1db6'
const SOURCE_THREAD_ID = '472d86e3-8765-473b-9582-5fd9e146c19e'

async function main() {
  const db = createAdminClient()
  const reasons: string[] = []

  const { data: candidate, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, site_id, candidate_point_id, subject_thread_id, scope, status')
    .eq('id', CANDIDATE_ID)
    .single()
  if (candErr) throw candErr
  if (candidate.site_id !== RUS_SITE_ID) reasons.push('site_id inattendu')
  if (candidate.candidate_point_id !== TARGET_POINT_ID) reasons.push('candidate_point_id inattendu')
  if (candidate.subject_thread_id !== SOURCE_THREAD_ID) reasons.push('subject_thread_id inattendu')
  if (candidate.scope !== 'thread') reasons.push(`scope=${candidate.scope} (attendu thread)`)
  if (candidate.status !== 'pending') reasons.push(`status=${candidate.status} (attendu pending)`)

  const { data: target, error: targetErr } = await db
    .from('tracked_point')
    .select('id, status, identity_status, merged_into_id')
    .eq('id', TARGET_POINT_ID)
    .single()
  if (targetErr) throw targetErr
  if (target.status !== 'active') reasons.push(`target.status=${target.status} (attendu active)`)
  if (target.identity_status === 'CONFLICTED') reasons.push('target CONFLICTED')
  if (target.merged_into_id !== null) reasons.push('target a merged_into_id')

  const { data: founderCheck, error: founderErr } = await db
    .from('tracked_point')
    .select('id')
    .eq('founding_kind', 'trackable_condition')
    .eq('founding_reference', SOURCE_THREAD_ID)
  if (founderErr) throw founderErr
  if ((founderCheck ?? []).length > 0) reasons.push('source devenue fondatrice d\'un point depuis le préflight')

  const { data: hardMemberCheck, error: hardErr } = await db
    .from('tracked_point_member')
    .select('id')
    .eq('subject_thread_id', SOURCE_THREAD_ID)
    .eq('status', 'active')
  if (hardErr) throw hardErr
  if ((hardMemberCheck ?? []).length > 0) reasons.push('source déjà membership active depuis le préflight')

  const abort = reasons.length > 0
  console.log('=== Re-vérification live avant APPLY ===')
  console.log({ candidate, target, founderCheck, hardMemberCheck })

  if (abort) {
    console.log('\nABORT — conditions non satisfaites au moment de l\'exécution:', reasons)
    writeFileSync('scripts/_p6e2b-03-apply-report.json', JSON.stringify({ generatedAt: new Date().toISOString(), abort: true, reasons }, null, 2))
    process.exit(1)
  }

  console.log('\nConditions OK — appel unique de acceptTraceIdentityCandidate(candidateId)...')
  const result = await acceptTraceIdentityCandidate({ siteId: RUS_SITE_ID, candidateId: CANDIDATE_ID })

  if (!result.ok) {
    console.log('\nÉCHEC (aucune écriture) :', result.error)
    writeFileSync('scripts/_p6e2b-03-apply-report.json', JSON.stringify({ generatedAt: new Date().toISOString(), abort: true, result }, null, 2))
    process.exit(1)
  }

  console.log('\n=== SUCCÈS — candidat accepté ===')
  console.log(result)

  writeFileSync('scripts/_p6e2b-03-apply-report.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    abort: false,
    candidateId: CANDIDATE_ID,
    targetPointId: TARGET_POINT_ID,
    sourceThreadId: SOURCE_THREAD_ID,
    result,
  }, null, 2))

  console.log('\nRapport écrit : scripts/_p6e2b-03-apply-report.json')
  console.log('=== ACCEPTATION APPLIQUÉE — 1 écriture transactionnelle, 0 autre ===')
}

main().catch((e) => { console.error(e); process.exit(1) })
