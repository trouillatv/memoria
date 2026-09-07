// Phase 6E.2B — étape 2/4 : préflight READ-ONLY complet + simulation de l'acceptation.
// Aucune écriture. Affiche les IDs réels exigés par Vincent (candidateId, sourceThreadId,
// targetPointId, scope, propositions du thread, famille, preuve d'unicité structurelle,
// identityStatus/derivedState/trajectoire/hard members/CBO de la cible) puis simule EN MÉMOIRE
// (jamais en base) l'ajout d'une membership HARD scope='thread' au Point cible — adapté du
// pattern _p6e1b-02-simulate-merge.ts à une insertion de membership unique plutôt qu'une fusion.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
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
const CANDIDATE_ID = 'da09c952-ebab-4c25-a7d8-8facb9fa0588'
const TARGET_POINT_ID = 'f1f377fc-e003-44cf-8aba-8050507c1db6' // "Vérifier la dotation des RIA"
const SOURCE_THREAD_ID = '472d86e3-8765-473b-9582-5fd9e146c19e'

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
  const notes: string[] = []

  // ── 1. Candidat, réel ──
  const { data: candidate, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, site_id, candidate_point_id, subject_thread_id, scope, status, created_at, reason, confidence')
    .eq('id', CANDIDATE_ID)
    .single()
  if (candErr) throw candErr
  if (candidate.candidate_point_id !== TARGET_POINT_ID) reasons.push('candidate_point_id ne correspond pas au TARGET_POINT_ID attendu')
  if (candidate.subject_thread_id !== SOURCE_THREAD_ID) reasons.push('subject_thread_id ne correspond pas au SOURCE_THREAD_ID attendu')
  if (candidate.status !== 'pending') reasons.push(`candidate.status=${candidate.status} (attendu pending)`)
  if (candidate.scope !== 'thread') reasons.push(`candidate.scope=${candidate.scope} (attendu thread)`)

  // ── 2. Propositions du thread source + famille (preuve d'homogénéité) ──
  const { data: proposalRows, error: propErr } = await db
    .from('document_extraction_proposal')
    .select('id, proposal_family, label, document_id, subject_thread_id')
    .eq('subject_thread_id', SOURCE_THREAD_ID)
  if (propErr) throw propErr
  const famillesPresentes = [...new Set((proposalRows ?? []).map((p) => p.proposal_family))]
  if (famillesPresentes.length !== 1) reasons.push(`${famillesPresentes.length} familles distinctes dans le thread source (attendu 1)`)

  // ── 3. Preuve d'unicité structurelle : combien de candidats pending pour ce thread ? ──
  const { data: siblingCandidates, error: sibErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, candidate_point_id, status')
    .eq('subject_thread_id', SOURCE_THREAD_ID)
    .eq('status', 'pending')
  if (sibErr) throw sibErr
  const distinctTargets = new Set((siblingCandidates ?? []).map((s) => s.candidate_point_id))
  if (distinctTargets.size !== 1) reasons.push(`${distinctTargets.size} cibles distinctes pour ce thread (attendu 1)`)

  // ── 4. Source sans Point fondateur propre / sans membership HARD ailleurs ──
  const { data: founderCheck, error: founderErr } = await db
    .from('tracked_point')
    .select('id, label')
    .eq('founding_kind', 'trackable_condition')
    .eq('founding_reference', SOURCE_THREAD_ID)
  if (founderErr) throw founderErr
  if ((founderCheck ?? []).length > 0) reasons.push(`source déjà fondatrice de ${founderCheck!.length} point(s): ${founderCheck!.map((p) => p.id).join(',')}`)

  const { data: hardMemberCheck, error: hardErr } = await db
    .from('tracked_point_member')
    .select('id, tracked_point_id, status')
    .eq('subject_thread_id', SOURCE_THREAD_ID)
    .eq('status', 'active')
  if (hardErr) throw hardErr
  if ((hardMemberCheck ?? []).length > 0) reasons.push(`source déjà membership active ailleurs: ${JSON.stringify(hardMemberCheck)}`)

  // ── 5. Chargement RUS complet (mêmes tables/colonnes que loadTrackedPointReadModel) ──
  const { data: rawPoints, error: pointsErr } = await db
    .from('tracked_point')
    .select('id, site_id, canonical_subject_id, label, status, merged_into_id, identity_status, founding_kind, founding_source, founding_reference, has_upstream_defect, created_at')
    .eq('site_id', RUS_SITE_ID)
  if (pointsErr) throw pointsErr
  const points: TrackedPointRow[] = (rawPoints ?? []).map((r) => ({
    id: r.id, siteId: r.site_id, canonicalSubjectId: r.canonical_subject_id, label: r.label,
    status: r.status, mergedIntoId: r.merged_into_id, identityStatus: r.identity_status,
    foundingKind: r.founding_kind, foundingSource: r.founding_source, foundingReference: r.founding_reference,
    hasUpstreamDefect: r.has_upstream_defect, createdAt: r.created_at,
  }))
  const pointIds = points.map((p) => p.id)
  const target = points.find((p) => p.id === TARGET_POINT_ID)
  if (!target) throw new Error('target introuvable dans le chargement RUS')
  if (target.status !== 'active') reasons.push(`target.status=${target.status} (attendu active)`)
  if (target.identityStatus === 'CONFLICTED') reasons.push('target CONFLICTED')

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

  const allThreadIds = [...new Set(memberRows.filter((r) => (r.scope ?? 'thread') === 'thread').map((r) => r.subject_thread_id)), SOURCE_THREAD_ID]
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

  function buildEvidence(memberPointIds: string[], extraThreadIds: string[] = []): { cboMembers: PointCboMember[]; hardMemberThreadIds: string[]; docs: PointLifecycleEvent[] } {
    const cboIds = [...new Set(memberPointIds.flatMap((id) => cboIdsByPoint.get(id) ?? []))]
    const cboMembers: PointCboMember[] = cboIds
      .map((cboId) => {
        const entry = cboReduced.get(cboId)
        return entry ? { cboId, reduced: entry.reduced } : null
      })
      .filter((m): m is PointCboMember => m !== null)
    const hardMemberThreadIds = [...new Set([...memberPointIds.flatMap((id) => threadsByPoint.get(id) ?? []), ...extraThreadIds])]
    const members = [...memberPointIds.flatMap((id) => membersByPoint.get(id) ?? []), ...extraThreadIds.map((t) => ({ subjectThreadId: t, scope: 'thread' as const, proposalIds: null, status: 'active' as const }))]
    const eligibleProposalIds = selectEligibleProposalIds(members, proposalsByThread)
    const provenance: PointDocProposalProvenance[] = [...eligibleProposalIds]
      .map((id) => proposalById.get(id))
      .filter((p): p is ProposalRow => p !== undefined)
      .map((p) => ({ proposalId: p.id, proposalFamily: p.proposal_family, documentStatus: p.document_status, date: docDate.get(p.document_id) ?? null }))
    const docs = assemblePointDocumentaryEvents(provenance)
    return { cboMembers, hardMemberThreadIds, docs }
  }

  // ── 6. État ACTUEL de la cible (avant acceptation) ──
  const evidenceBefore = buildEvidence([TARGET_POINT_ID])
  const entryBefore = projectTrackedPoint(target, evidenceBefore.cboMembers, evidenceBefore.hardMemberThreadIds, [], evidenceBefore.docs, TARGET_POINT_ID)

  // ── 7. SIMULATION : ajout EN MÉMOIRE d'une membership HARD scope=thread (SOURCE_THREAD_ID) ──
  let simulationError: string | null = null
  let entryAfter: ReturnType<typeof projectTrackedPoint> | null = null
  try {
    const evidenceAfter = buildEvidence([TARGET_POINT_ID], [SOURCE_THREAD_ID])
    entryAfter = projectTrackedPoint(target, evidenceAfter.cboMembers, evidenceAfter.hardMemberThreadIds, [], evidenceAfter.docs, TARGET_POINT_ID)
    if (!entryAfter.hardMemberThreadIds.includes(SOURCE_THREAD_ID)) reasons.push('simulation: SOURCE_THREAD_ID absent de hardMemberThreadIds après ajout')
    const newDocIds = new Set(evidenceAfter.docs.map((d) => d.id))
    const oldDocIds = new Set(evidenceBefore.docs.map((d) => d.id))
    const addedDocIds = [...newDocIds].filter((id) => !oldDocIds.has(id))
    // Non-bloquant par construction (mandat Vincent) : l'unique proposition du thread source a
    // document_status=null (pas 'open'), donc assemblePointDocumentaryEvents ne produit aucun
    // événement pour elle — vérifié : les 4 témoins RUS SAFE_SINGLE_TRACE_THREAD ont tous
    // document_status=null sur leurs propositions. La preuve qui compte ici est structurelle
    // (hardMemberThreadIds), pas la trajectoire — « l'état peut légitimement ne pas changer ».
    if (addedDocIds.length === 0) {
      notes.push('aucun nouvel événement documentaire (document_status de la proposition source ≠ \'open\') — attendu, pas un échec : la preuve structurelle (hardMemberThreadIds) est le critère qui compte ici')
    }
  } catch (e) {
    simulationError = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
    reasons.push(`simulation error: ${simulationError}`)
  }

  const abort = reasons.length > 0

  const report = {
    mandate: 'Phase 6E.2B étape 2/4 — préflight + simulation READ-ONLY (0 écriture)',
    generatedAt: new Date().toISOString(),
    witness: {
      candidateId: CANDIDATE_ID,
      sourceThreadId: SOURCE_THREAD_ID,
      targetPointId: TARGET_POINT_ID,
      candidateScope: candidate.scope,
      candidateStatus: candidate.status,
    },
    sourceProof: {
      threadProposals: proposalRows,
      famillesPresentes,
      distinctPendingTargetsForThread: [...distinctTargets],
      founderCheck,
      hardMemberCheckElsewhere: hardMemberCheck,
    },
    targetBefore: {
      row: { id: target.id, label: target.label, status: target.status, identityStatus: target.identityStatus, foundingKind: target.foundingKind },
      entry: entryBefore,
    },
    simulatedAfter: {
      entry: entryAfter,
      simulationError,
    },
    verdict: { abort, reasons, notes },
  }

  writeFileSync('scripts/_p6e2b-02-simulate-accept-report.json', JSON.stringify(report, null, 2))

  console.log('=== Témoin ===', report.witness)
  console.log('\n=== Preuve source (propositions du thread + unicité) ===')
  console.log({ famillesPresentes, distinctPendingTargetsForThread: [...distinctTargets], founderCheck, hardMemberCheckElsewhere: hardMemberCheck })
  console.log('\n=== Cible AVANT ===')
  console.log({ id: entryBefore.id, label: entryBefore.label, status: entryBefore.status, identityStatus: entryBefore.identityStatus, derivedState: entryBefore.derivedState, cboIds: entryBefore.cboIds, hardMemberThreadIds: entryBefore.hardMemberThreadIds, trajectory: entryBefore.trajectory, hasConflict: entryBefore.hasConflict, hasDocumentaryDivergence: entryBefore.hasDocumentaryDivergence })
  console.log('\n=== Cible APRÈS (simulation en mémoire, 0 écriture) ===')
  if (simulationError) {
    console.log(`ERREUR DE SIMULATION : ${simulationError}`)
  } else {
    console.log({ derivedState: entryAfter?.derivedState, cboIds: entryAfter?.cboIds, hardMemberThreadIds: entryAfter?.hardMemberThreadIds, trajectory: entryAfter?.trajectory, hasConflict: entryAfter?.hasConflict, hasDocumentaryDivergence: entryAfter?.hasDocumentaryDivergence, markers: entryAfter?.markers })
  }

  console.log(`\n=== VERDICT === abort=${abort}`)
  if (abort) console.log('raisons:', reasons)
  if (notes.length > 0) console.log('notes (non-bloquantes):', notes)

  console.log('\nRapport écrit : scripts/_p6e2b-02-simulate-accept-report.json')
  console.log('=== HARD STOP — 0 écriture ===')
}

main().catch((e) => { console.error(e); process.exit(1) })
