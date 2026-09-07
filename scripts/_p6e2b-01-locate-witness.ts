// Phase 6E.2B — étape 1/4 : localiser et valider (READ-ONLY) le témoin pilote TRACE_TO_POINT.
// Aucune écriture. Revalide LIVE (via classifyTraceIdentityCandidate — même fonction que le
// wrapper d'acceptation, jamais une copie) les 4 candidats RUS identifiés SAFE_SINGLE_TRACE_THREAD
// par l'audit 6E.2A (scripts/_p6e2a-trace-to-point-evidence-scope-audit-report.json), et vérifie
// les critères posés par Vincent : 1 seule cible, pending, target active/non CONFLICTED, source
// sans Point fondateur propre, source sans membership HARD vers un autre point, hors des 2 OCEF
// NEEDS_SCOPE_REFINEMENT.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  classifyTraceIdentityCandidate,
  type TraceScopePointRow,
  type TraceScopeMemberRow,
} from '@/lib/knowledge/tracked-point-trace-scope'

const RUS_SITE_ID = 'bebcdf12-fec0-44d8-858b-249ddea02db4'
// Les 4 candidats RUS SAFE_SINGLE_TRACE_THREAD identifiés par l'audit 6E.2A (report ligne 59-107).
const RUS_CANDIDATE_IDS = [
  'da09c952-ebab-4c25-a7d8-8facb9fa0588',
  'bc099e2c-134d-4e0c-bcfd-90485c05bfaa',
  '2b11a6bd-0947-478c-a2b9-00aa122392bf',
  'ba9095ba-df47-4c22-8a4f-1ac962bec3e0',
]

async function main() {
  const db = createAdminClient()

  const { data: rawPoints, error: pointsErr } = await db
    .from('tracked_point')
    .select('id, site_id, status, merged_into_id, identity_status, founding_kind, founding_reference, created_at, label')
    .eq('site_id', RUS_SITE_ID)
  if (pointsErr) throw pointsErr
  if (!rawPoints || rawPoints.length === 0) throw new Error('aucun tracked_point RUS')

  const points: TraceScopePointRow[] = rawPoints.map((p) => ({
    id: p.id, siteId: p.site_id, status: p.status as TraceScopePointRow['status'],
    mergedIntoId: p.merged_into_id, foundingKind: p.founding_kind, foundingReference: p.founding_reference,
    createdAt: p.created_at,
  }))
  const pointIds = points.map((p) => p.id)

  const { data: rawMembers, error: memErr } = await db
    .from('tracked_point_member')
    .select('tracked_point_id, subject_thread_id, scope, status, created_at')
    .in('tracked_point_id', pointIds)
  if (memErr) throw memErr

  const members: TraceScopeMemberRow[] = (rawMembers ?? []).map((m) => ({
    trackedPointId: m.tracked_point_id, subjectThreadId: m.subject_thread_id,
    scope: (m.scope ?? 'thread') as TraceScopeMemberRow['scope'], status: m.status as TraceScopeMemberRow['status'],
    createdAt: m.created_at,
  }))

  const { data: rawCandidates, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, site_id, candidate_point_id, subject_thread_id, scope, status, created_at')
    .in('id', RUS_CANDIDATE_IDS)
  if (candErr) throw candErr
  if (!rawCandidates || rawCandidates.length !== RUS_CANDIDATE_IDS.length) throw new Error('candidats témoins introuvables')

  const results: Array<Record<string, unknown>> = []

  for (const c of rawCandidates) {
    // 1 seule cible candidate : combien de candidats pending existent pour ce même subject_thread_id ?
    const { data: siblingCandidates, error: sibErr } = await db
      .from('tracked_point_identity_candidate')
      .select('id, candidate_point_id, status')
      .eq('subject_thread_id', c.subject_thread_id)
      .eq('status', 'pending')
    if (sibErr) throw sibErr
    const distinctTargets = new Set((siblingCandidates ?? []).map((s) => s.candidate_point_id))
    const singleTarget = distinctTargets.size === 1

    const { data: proposalRows, error: propErr } = await db
      .from('document_extraction_proposal')
      .select('id, proposal_family')
      .eq('subject_thread_id', c.subject_thread_id)
    if (propErr) throw propErr
    const famillesPresentes = [...new Set((proposalRows ?? []).map((p) => p.proposal_family))]

    const classification = classifyTraceIdentityCandidate(
      { id: c.id, siteId: c.site_id, candidatePointId: c.candidate_point_id, subjectThreadId: c.subject_thread_id, scope: c.scope, createdAt: c.created_at },
      points, members, famillesPresentes,
    )

    const target = points.find((p) => p.id === c.candidate_point_id)

    const eligible =
      c.status === 'pending' &&
      c.scope === 'thread' &&
      singleTarget &&
      target !== undefined &&
      target.status === 'active' &&
      classification.category === 'SAFE_SINGLE_TRACE_THREAD'

    results.push({
      candidateId: c.id,
      subjectThreadId: c.subject_thread_id,
      candidatePointId: c.candidate_point_id,
      candidateStatus: c.status,
      candidateScope: c.scope,
      distinctPendingTargetsForThread: [...distinctTargets],
      singleTarget,
      proposalCount: (proposalRows ?? []).length,
      famillesPresentes,
      classification,
      targetStatus: target?.status ?? null,
      targetIdentityStatus: target?.identityStatus ?? null,
      targetLabel: rawPoints.find((p) => p.id === c.candidate_point_id)?.label ?? null,
      eligible,
    })
  }

  const chosen = results.find((r) => r.eligible === true) ?? null

  const report = {
    mandate: 'Phase 6E.2B étape 1/4 — localisation + validation READ-ONLY du témoin pilote (0 écriture)',
    generatedAt: new Date().toISOString(),
    site: 'RUS',
    siteId: RUS_SITE_ID,
    candidates: results,
    chosenCandidateId: chosen?.candidateId ?? null,
  }

  writeFileSync('scripts/_p6e2b-01-locate-witness-report.json', JSON.stringify(report, null, 2))

  console.log('=== Candidats RUS SAFE_SINGLE_TRACE_THREAD (audit 6E.2A) — revalidation live ===')
  for (const r of results) console.log(r)

  console.log(`\n=== Témoin choisi === ${chosen ? chosen.candidateId : 'AUCUN — 0 candidat éligible'}`)
  console.log('\nRapport écrit : scripts/_p6e2b-01-locate-witness-report.json')
  console.log('=== HARD STOP — 0 écriture ===')
}

main().catch((e) => { console.error(e); process.exit(1) })
