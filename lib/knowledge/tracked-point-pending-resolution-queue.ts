// Phase 6E.3B.3C — read-model de file pour RESOLUTION_WITHOUT_KNOWN_PROBLEM (mandat Vincent,
// point 3 "read-model de file"). Pendant, pour la résolution orpheline, de
// tracked-point-trace-queue.ts (TRACE_TO_POINT) et tracked-point-consolidation-queue.ts
// (Point↔Point) : une fonction pure (buildPendingResolutionQueue) + un chargeur async séparé
// (loadPendingResolutionQueue). AUCUNE écriture. AUCUN LLM. AUCUN matching supplémentaire —
// ce module ne fait que projeter l'état déjà persisté (tracked_point_pending_trace,
// tracked_point_pending_trace_evidence, tracked_point_identity_candidate,
// subject_thread_identity) en unités décidables par un humain.
//
// Taxonomie portée telle quelle depuis _p6e3b3a-orphan-target-audit.mjs (audit READ-ONLY
// 6E.3B.3A, déjà validé sur données réelles) : known_identity_targets décide en premier
// (KNOWN_SINGLE/KNOWN_MULTI), sinon same_subject_active_points (SUBJECT_SINGLE/SUBJECT_MULTI),
// sinon SEARCH_REQUIRED (aucune cible locale — 114/155 cas réels au 6E.3B.3A). Les deux
// tableaux knownIdentityTargets[]/sameSubjectSuggestions[] restent des FAITS bruts, exposés
// intégralement quel que soit le mode retenu — jamais tronqués : targetingMode encode
// uniquement "quelle question poser en premier", pas ce qui existe réellement.
//
// Distinction de vocabulaire non négociable (Vincent) : sameSubjectSuggestions ne sont JAMAIS
// des identity candidates. Une proximité de Sujet ne fonde aucun droit à une association
// automatique (même doctrine que tracked-point-membership-candidates.ts : le sujet sert à
// TROUVER des candidats, jamais à DÉCIDER). Ce module ne matérialise donc jamais de ligne
// tracked_point_identity_candidate à partir d'une sameSubjectSuggestion.
//
// EVIDENCE_SCOPE_UNRESOLVED reste visible dans la file (mandat point 6) — jamais filtré — mais
// actionable=false : aucun bouton d'association tant que resolve_pending_trace_evidence (394)
// n'a pas figé la portée de preuve.
//
// STALE_ALREADY_CONSUMED (thread déjà membre HARD actif d'un AUTRE Point, ou déjà fondateur)
// N'EST PAS une entrée de file : la RPC associate_pending_resolution_to_point la refuserait
// systématiquement (guard 15), il n'y a plus de décision humaine à prendre. Retiré de `entries`
// mais jamais perdu en silence : ses ids réapparaissent dans `excludedAlreadyConsumed`.

import { createAdminClient } from '@/lib/supabase/admin'
import { loadTrackedPointReadModel, type PointReadModelEntry } from './tracked-point-read-model'

export type PendingResolutionTargetingMode =
  | 'KNOWN_SINGLE'
  | 'KNOWN_MULTI'
  | 'SUBJECT_SINGLE'
  | 'SUBJECT_MULTI'
  | 'SEARCH_REQUIRED'
  | 'EVIDENCE_SCOPE_UNRESOLVED'

export type PendingResolutionPointRef = {
  pointId: string
  label: string | null
  identityStatus: PointReadModelEntry['identityStatus'] | null
  derivedState: PointReadModelEntry['derivedState'] | null
  subjectId: string | null
  subjectLabel: string | null
  latestMeaningfulEventAt: string | null
}

export type PendingResolutionKnownTarget = PendingResolutionPointRef & { candidateId: string }
export type PendingResolutionSubjectSuggestion = PendingResolutionPointRef

export type PendingResolutionQueueEntry = {
  pendingTraceId: string
  sourceThreadId: string
  evidenceStatus: string
  evidenceBasis: string | null
  evidenceProposalIds: string[]
  sourceLabel: string | null
  sourceDate: string | null
  sourceDocumentId: string | null
  sourceDocumentFilename: string | null
  sourceDocumentEffectiveDate: string | null
  sourcePage: number | null
  knownIdentityTargets: PendingResolutionKnownTarget[]
  sameSubjectSuggestions: PendingResolutionSubjectSuggestion[]
  targetingMode: PendingResolutionTargetingMode
  actionable: boolean
}

export type PendingResolutionQueue = {
  siteId: string
  entries: PendingResolutionQueueEntry[]
  totalEntries: number
  excludedAlreadyConsumed: string[]
}

export type PendingResolutionTraceRow = {
  id: string
  sourceThreadId: string
  evidenceStatus: string
  evidenceBasis: string | null
}

export type PendingResolutionSourceProposal = {
  id: string
  label: string | null
  documentId: string | null
  documentFilename: string | null
  documentEffectiveDate: string | null
  sourcePage: number | null
  createdAt: string | null
}

function toPointRef(
  pointId: string,
  pointDetailsById: Map<string, PointReadModelEntry>,
  subjectLabelBySubjectId: Map<string, string | null>,
): PendingResolutionPointRef {
  const detail = pointDetailsById.get(pointId)
  const subjectId = detail?.ownerCanonicalSubjectId ?? null
  return {
    pointId,
    label: detail?.label ?? null,
    identityStatus: detail?.identityStatus ?? null,
    derivedState: detail?.derivedState ?? null,
    subjectId,
    subjectLabel: subjectId ? (subjectLabelBySubjectId.get(subjectId) ?? null) : null,
    latestMeaningfulEventAt: detail?.latestMeaningfulEventAt ?? null,
  }
}

function resolveTargetingMode(
  evidenceStatus: string,
  evidenceProposalIds: string[],
  knownCount: number,
  sameSubjectCount: number,
): { targetingMode: PendingResolutionTargetingMode; actionable: boolean } {
  // EVIDENCE_MISSING (394 garantit resolved ⟺ ≥1 ligne) est un cas défensif : traité comme
  // EVIDENCE_SCOPE_UNRESOLVED côté file, jamais offert comme actionnable — même sans preuve
  // figée, il n'y a rien à faire ici tant que le drift n'est pas corrigé en amont.
  if (evidenceStatus !== 'resolved' || evidenceProposalIds.length === 0) {
    return { targetingMode: 'EVIDENCE_SCOPE_UNRESOLVED', actionable: false }
  }
  if (knownCount === 1) return { targetingMode: 'KNOWN_SINGLE', actionable: true }
  if (knownCount >= 2) return { targetingMode: 'KNOWN_MULTI', actionable: true }
  if (sameSubjectCount === 1) return { targetingMode: 'SUBJECT_SINGLE', actionable: true }
  if (sameSubjectCount >= 2) return { targetingMode: 'SUBJECT_MULTI', actionable: true }
  return { targetingMode: 'SEARCH_REQUIRED', actionable: true }
}

// buildPendingResolutionQueue : pur. N'accepte que des traces déjà filtrées
// kind='RESOLUTION_WITHOUT_KNOWN_PROBLEM' AND status='pending' par l'appelant (même convention
// que buildTraceIdentityQueue) — une trace resolved/dismissed n'a plus sa place dans une file
// de décisions à prendre.
export function buildPendingResolutionQueue(
  siteId: string,
  traces: PendingResolutionTraceRow[],
  evidenceProposalIdsByTrace: Map<string, string[]>,
  sourceProposalsByThread: Map<string, PendingResolutionSourceProposal[]>,
  knownTargetsByThread: Map<string, { candidateId: string; pointId: string }[]>,
  sameSubjectPointIdsByThread: Map<string, string[]>,
  alreadyConsumedThreadIds: Set<string>,
  pointDetailsById: Map<string, PointReadModelEntry>,
  subjectLabelBySubjectId: Map<string, string | null>,
): PendingResolutionQueue {
  const entries: PendingResolutionQueueEntry[] = []
  const excludedAlreadyConsumed: string[] = []

  for (const trace of traces) {
    if (alreadyConsumedThreadIds.has(trace.sourceThreadId)) {
      excludedAlreadyConsumed.push(trace.id)
      continue
    }

    const evidenceProposalIds = evidenceProposalIdsByTrace.get(trace.id) ?? []
    const knownRaw = knownTargetsByThread.get(trace.sourceThreadId) ?? []
    const sameSubjectRaw = sameSubjectPointIdsByThread.get(trace.sourceThreadId) ?? []

    const knownIdentityTargets: PendingResolutionKnownTarget[] = knownRaw.map((k) => ({
      candidateId: k.candidateId,
      ...toPointRef(k.pointId, pointDetailsById, subjectLabelBySubjectId),
    }))
    const sameSubjectSuggestions: PendingResolutionSubjectSuggestion[] = sameSubjectRaw.map((pointId) =>
      toPointRef(pointId, pointDetailsById, subjectLabelBySubjectId),
    )

    const { targetingMode, actionable } = resolveTargetingMode(
      trace.evidenceStatus,
      evidenceProposalIds,
      knownIdentityTargets.length,
      sameSubjectSuggestions.length,
    )

    const sourceProposals = sourceProposalsByThread.get(trace.sourceThreadId) ?? []
    const firstProposal = sourceProposals[0] ?? null

    entries.push({
      pendingTraceId: trace.id,
      sourceThreadId: trace.sourceThreadId,
      evidenceStatus: trace.evidenceStatus,
      evidenceBasis: trace.evidenceBasis,
      evidenceProposalIds,
      sourceLabel: firstProposal?.label ?? null,
      sourceDate: firstProposal?.createdAt ?? null,
      sourceDocumentId: firstProposal?.documentId ?? null,
      sourceDocumentFilename: firstProposal?.documentFilename ?? null,
      sourceDocumentEffectiveDate: firstProposal?.documentEffectiveDate ?? null,
      sourcePage: firstProposal?.sourcePage ?? null,
      knownIdentityTargets,
      sameSubjectSuggestions,
      targetingMode,
      actionable,
    })
  }

  return { siteId, entries, totalEntries: entries.length, excludedAlreadyConsumed }
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export async function loadPendingResolutionQueue(siteId: string): Promise<PendingResolutionQueue> {
  const db = createAdminClient()

  const { data: rawTraces, error: tracesErr } = await db
    .from('tracked_point_pending_trace')
    .select('id, source_thread_id, evidence_status, evidence_basis')
    .eq('site_id', siteId)
    .eq('kind', 'RESOLUTION_WITHOUT_KNOWN_PROBLEM')
    .eq('status', 'pending')
  if (tracesErr) throw tracesErr

  const traces: PendingResolutionTraceRow[] = (rawTraces ?? []).map((t) => ({
    id: t.id,
    sourceThreadId: t.source_thread_id,
    evidenceStatus: t.evidence_status,
    evidenceBasis: t.evidence_basis,
  }))
  const traceIds = traces.map((t) => t.id)
  const threadIds = [...new Set(traces.map((t) => t.sourceThreadId))]

  const { data: rawEvidence, error: evErr } = await db
    .from('tracked_point_pending_trace_evidence')
    .select('pending_trace_id, proposal_id')
    .in('pending_trace_id', traceIds.length > 0 ? traceIds : [NIL_UUID])
  if (evErr) throw evErr

  const evidenceProposalIdsByTrace = new Map<string, string[]>()
  for (const e of rawEvidence ?? []) {
    const list = evidenceProposalIdsByTrace.get(e.pending_trace_id) ?? []
    list.push(e.proposal_id)
    evidenceProposalIdsByTrace.set(e.pending_trace_id, list)
  }

  const { data: rawProposals, error: propErr } = await db
    .from('document_extraction_proposal')
    .select('id, subject_thread_id, label, document_id, source_page, created_at')
    .in('subject_thread_id', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (propErr) throw propErr

  const documentIds = [...new Set((rawProposals ?? []).map((p) => p.document_id).filter((id): id is string => !!id))]
  const { data: rawDocuments, error: docErr } = await db
    .from('documents')
    .select('id, filename, effective_date')
    .in('id', documentIds.length > 0 ? documentIds : [NIL_UUID])
  if (docErr) throw docErr
  const documentsById = new Map((rawDocuments ?? []).map((d) => [d.id, d]))

  const sourceProposalsByThread = new Map<string, PendingResolutionSourceProposal[]>()
  for (const p of rawProposals ?? []) {
    const doc = p.document_id ? documentsById.get(p.document_id) : undefined
    const list = sourceProposalsByThread.get(p.subject_thread_id) ?? []
    list.push({
      id: p.id,
      label: p.label,
      documentId: p.document_id,
      documentFilename: doc?.filename ?? null,
      documentEffectiveDate: doc?.effective_date ?? null,
      sourcePage: p.source_page ?? null,
      createdAt: p.created_at,
    })
    sourceProposalsByThread.set(p.subject_thread_id, list)
  }

  const { data: rawCandidates, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, candidate_point_id, subject_thread_id')
    .eq('site_id', siteId)
    .eq('status', 'pending')
    .in('subject_thread_id', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (candErr) throw candErr

  const knownTargetsByThread = new Map<string, { candidateId: string; pointId: string }[]>()
  for (const c of rawCandidates ?? []) {
    const list = knownTargetsByThread.get(c.subject_thread_id) ?? []
    // Une même paire (thread, point) ne doit jamais compter deux fois — deux candidats
    // pending distincts vers le MÊME Point restent un seul knownIdentityTarget côté file
    // (la question posée à l'humain est "quel Point ?", pas "combien de lignes candidates ?").
    if (!list.some((k) => k.pointId === c.candidate_point_id)) {
      list.push({ candidateId: c.id, pointId: c.candidate_point_id })
    }
    knownTargetsByThread.set(c.subject_thread_id, list)
  }

  const { data: rawIdentities, error: identErr } = await db
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('subject_thread_id', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (identErr) throw identErr
  const subjectIdByThread = new Map((rawIdentities ?? []).map((r) => [r.subject_thread_id, r.canonical_subject_id]))

  const { points: pointReadModelEntries } = await loadTrackedPointReadModel(siteId)
  const pointDetailsById = new Map(pointReadModelEntries.map((p) => [p.id, p]))

  const allSubjectIds = [
    ...new Set(pointReadModelEntries.map((p) => p.ownerCanonicalSubjectId).filter((id): id is string => !!id)),
  ]
  const subjectLabelBySubjectId = new Map<string, string | null>()
  if (allSubjectIds.length > 0) {
    const { data: rawSubjects, error: subjErr } = await db
      .from('canonical_subject')
      .select('id, label')
      .in('id', allSubjectIds)
    if (subjErr) throw subjErr
    for (const s of rawSubjects ?? []) subjectLabelBySubjectId.set(s.id, s.label)
  }

  const activePointsBySubject = new Map<string, string[]>()
  for (const p of pointReadModelEntries) {
    if (p.status !== 'active' || !p.ownerCanonicalSubjectId) continue
    const list = activePointsBySubject.get(p.ownerCanonicalSubjectId) ?? []
    list.push(p.id)
    activePointsBySubject.set(p.ownerCanonicalSubjectId, list)
  }

  const sameSubjectPointIdsByThread = new Map<string, string[]>()
  for (const threadId of threadIds) {
    const subjectId = subjectIdByThread.get(threadId)
    if (!subjectId) continue
    sameSubjectPointIdsByThread.set(threadId, activePointsBySubject.get(subjectId) ?? [])
  }

  // STALE_ALREADY_CONSUMED : thread déjà membre HARD actif d'un Point (thread_already_member),
  // ou déjà fondateur littéral d'un Point (thread_already_founder) — même OR que l'audit
  // 6E.3B.3A (_p6e3b3a-orphan-target-audit.mjs).
  const { data: rawMembers, error: memErr } = await db
    .from('tracked_point_member')
    .select('subject_thread_id')
    .eq('status', 'active')
    .in('subject_thread_id', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (memErr) throw memErr
  const alreadyConsumedThreadIds = new Set((rawMembers ?? []).map((m) => m.subject_thread_id))

  const { data: rawFounders, error: founderErr } = await db
    .from('tracked_point')
    .select('founding_reference')
    .eq('site_id', siteId)
    .in('founding_reference', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (founderErr) throw founderErr
  for (const f of rawFounders ?? []) {
    if (f.founding_reference) alreadyConsumedThreadIds.add(f.founding_reference)
  }

  return buildPendingResolutionQueue(
    siteId,
    traces,
    evidenceProposalIdsByTrace,
    sourceProposalsByThread,
    knownTargetsByThread,
    sameSubjectPointIdsByThread,
    alreadyConsumedThreadIds,
    pointDetailsById,
    subjectLabelBySubjectId,
  )
}
