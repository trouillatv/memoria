// Phase 6E.3B.2 — read-model de file pour TRACKABILITY_UNDETERMINED (mandat Vincent, arbitrage
// 6E.4A point 3 : "queue doit naturellement partir des traces : kind=TRACKABILITY_UNDETERMINED /
// status=pending / evidence_status=resolved-ish, et exclure/classer les cas stale de la même
// manière que les autres queues"). Même convention pure/async que
// tracked-point-pending-resolution-queue.ts (RESOLUTION_WITHOUT_KNOWN_PROBLEM) et
// tracked-point-evidence-scope-queue.ts : une fonction pure (buildPendingTrackabilityQueue) +
// un chargeur async séparé (loadPendingTrackabilityQueue). AUCUNE écriture, AUCUN LLM.
//
// La question posée par ce read-model est binaire ("faut-il suivre cette situation ?"), pas un
// choix de cible — contrairement à la file de résolution orpheline, il n'y a donc ni
// knownIdentityTargets ni sameSubjectSuggestions ici : confirm_pending_trackability (395) fonde
// TOUJOURS un nouveau Point PROVISIONAL, il n'en choisit jamais un existant.
//
// evidence_status='unresolved' reste visible dans la file (même doctrine que
// buildPendingResolutionQueue) — jamais filtré — mais actionable=false : aucun bouton de
// confirmation tant que resolve_pending_trace_evidence (394) n'a pas figé la portée de preuve
// (c'est alors la carte 6E.3C "Quelle information constitue réellement la preuve ?" qui prend
// le relais, jamais celle-ci).
//
// STALE_ALREADY_TRACKED (thread déjà membre HARD actif d'un Point, ou déjà fondateur littéral)
// N'EST PAS une entrée de file : la RPC confirm_pending_trackability la refuserait
// systématiquement (guard STALE_ALREADY_TRACKED), il n'y a plus de décision humaine à prendre.
// Retiré de `entries` mais jamais perdu en silence : ses ids réapparaissent dans
// `excludedAlreadyTracked` (même calcul double-source qu'excludedAlreadyConsumed dans
// tracked-point-pending-resolution-queue.ts : tracked_point_member actif + tracked_point.
// founding_reference).

import { createAdminClient } from '@/lib/supabase/admin'
import { pendingTraceVisibleFilter } from '@/lib/db/tracked-point-pending-resolution'

export type PendingTrackabilityQueueEntry = {
  pendingTraceId: string
  sourceThreadId: string
  siteId: string
  subjectId: string | null
  subjectLabel: string | null
  reason: string | null
  createdAt: string | null
  evidenceStatus: string
  evidenceProposalIds: string[]
  sourceLabel: string | null
  sourceDate: string | null
  sourceDocumentId: string | null
  sourceDocumentFilename: string | null
  sourceDocumentType: string | null
  sourceDocumentEffectiveDate: string | null
  sourcePage: number | null
  sourceExcerpt: string | null
  hasVerbatimExcerpt: boolean
  actionable: boolean
}

export type PendingTrackabilityQueue = {
  siteId: string
  entries: PendingTrackabilityQueueEntry[]
  totalEntries: number
  excludedAlreadyTracked: string[]
}

export type PendingTrackabilityTraceRow = {
  id: string
  sourceThreadId: string
  siteId: string
  reason: string | null
  createdAt: string | null
  evidenceStatus: string
}

export type PendingTrackabilitySourceProposal = {
  id: string
  label: string | null
  documentId: string | null
  documentFilename: string | null
  documentType: string | null
  documentEffectiveDate: string | null
  sourcePage: number | null
  sourceExcerpt: string | null
  createdAt: string | null
}

// buildPendingTrackabilityQueue : pur. N'accepte que des traces déjà filtrées
// kind='TRACKABILITY_UNDETERMINED' AND status='pending' par l'appelant (même convention que
// buildPendingResolutionQueue) — une trace resolved/dismissed n'a plus sa place dans une file
// de décisions à prendre.
export function buildPendingTrackabilityQueue(
  siteId: string,
  traces: PendingTrackabilityTraceRow[],
  evidenceProposalIdsByTrace: Map<string, string[]>,
  sourceProposalsByThread: Map<string, PendingTrackabilitySourceProposal[]>,
  subjectIdByThreadId: Map<string, string | null>,
  subjectLabelBySubjectId: Map<string, string | null>,
  alreadyTrackedThreadIds: Set<string>,
): PendingTrackabilityQueue {
  const entries: PendingTrackabilityQueueEntry[] = []
  const excludedAlreadyTracked: string[] = []

  for (const trace of traces) {
    if (alreadyTrackedThreadIds.has(trace.sourceThreadId)) {
      excludedAlreadyTracked.push(trace.id)
      continue
    }

    const evidenceProposalIds = evidenceProposalIdsByTrace.get(trace.id) ?? []
    const actionable = trace.evidenceStatus === 'resolved' && evidenceProposalIds.length > 0

    const sourceProposals = sourceProposalsByThread.get(trace.sourceThreadId) ?? []
    const firstProposal = sourceProposals[0] ?? null

    const subjectId = subjectIdByThreadId.get(trace.sourceThreadId) ?? null
    const sourceExcerpt = firstProposal?.sourceExcerpt ?? null

    entries.push({
      pendingTraceId: trace.id,
      sourceThreadId: trace.sourceThreadId,
      siteId: trace.siteId,
      subjectId,
      subjectLabel: subjectId ? (subjectLabelBySubjectId.get(subjectId) ?? null) : null,
      reason: trace.reason,
      createdAt: trace.createdAt,
      evidenceStatus: trace.evidenceStatus,
      evidenceProposalIds,
      sourceLabel: firstProposal?.label ?? null,
      sourceDate: firstProposal?.createdAt ?? null,
      sourceDocumentId: firstProposal?.documentId ?? null,
      sourceDocumentFilename: firstProposal?.documentFilename ?? null,
      sourceDocumentType: firstProposal?.documentType ?? null,
      sourceDocumentEffectiveDate: firstProposal?.documentEffectiveDate ?? null,
      sourcePage: firstProposal?.sourcePage ?? null,
      sourceExcerpt,
      hasVerbatimExcerpt: sourceExcerpt !== null,
      actionable,
    })
  }

  return { siteId, entries, totalEntries: entries.length, excludedAlreadyTracked }
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export async function loadPendingTrackabilityQueue(siteId: string): Promise<PendingTrackabilityQueue> {
  const db = createAdminClient()

  const { data: rawTraces, error: tracesErr } = await db
    .from('tracked_point_pending_trace')
    .select('id, source_thread_id, site_id, reason, created_at, evidence_status')
    .eq('site_id', siteId)
    .eq('kind', 'TRACKABILITY_UNDETERMINED')
    .eq('status', 'pending')
    .or(pendingTraceVisibleFilter(new Date().toISOString()))
  if (tracesErr) throw tracesErr

  const traces: PendingTrackabilityTraceRow[] = (rawTraces ?? []).map((t) => ({
    id: t.id,
    sourceThreadId: t.source_thread_id,
    siteId: t.site_id,
    reason: t.reason,
    createdAt: t.created_at,
    evidenceStatus: t.evidence_status,
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
    .select('id, subject_thread_id, label, document_id, source_page, source_excerpt, created_at')
    .in('subject_thread_id', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (propErr) throw propErr

  const documentIds = [...new Set((rawProposals ?? []).map((p) => p.document_id).filter((id): id is string => !!id))]
  const { data: rawDocuments, error: docErr } = await db
    .from('documents')
    .select('id, filename, document_type, effective_date')
    .in('id', documentIds.length > 0 ? documentIds : [NIL_UUID])
  if (docErr) throw docErr
  const documentsById = new Map((rawDocuments ?? []).map((d) => [d.id, d]))

  const sourceProposalsByThread = new Map<string, PendingTrackabilitySourceProposal[]>()
  for (const p of rawProposals ?? []) {
    const doc = p.document_id ? documentsById.get(p.document_id) : undefined
    const list = sourceProposalsByThread.get(p.subject_thread_id) ?? []
    list.push({
      id: p.id,
      label: p.label,
      documentId: p.document_id,
      documentFilename: doc?.filename ?? null,
      documentType: doc?.document_type ?? null,
      documentEffectiveDate: doc?.effective_date ?? null,
      sourcePage: p.source_page ?? null,
      sourceExcerpt: p.source_excerpt?.trim() || null,
      createdAt: p.created_at,
    })
    sourceProposalsByThread.set(p.subject_thread_id, list)
  }

  const { data: rawIdentities, error: identErr } = await db
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('subject_thread_id', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (identErr) throw identErr
  const subjectIdByThreadId = new Map<string, string | null>(
    (rawIdentities ?? []).map((r) => [r.subject_thread_id, r.canonical_subject_id]),
  )

  const subjectIds = [...new Set([...subjectIdByThreadId.values()].filter((id): id is string => !!id))]
  const subjectLabelBySubjectId = new Map<string, string | null>()
  if (subjectIds.length > 0) {
    const { data: rawSubjects, error: subjErr } = await db
      .from('canonical_subject')
      .select('id, label')
      .in('id', subjectIds)
    if (subjErr) throw subjErr
    for (const s of rawSubjects ?? []) subjectLabelBySubjectId.set(s.id, s.label)
  }

  // STALE_ALREADY_TRACKED : thread déjà membre HARD actif d'un Point, ou déjà fondateur littéral
  // d'un Point — même double calcul qu'alreadyConsumedThreadIds dans
  // tracked-point-pending-resolution-queue.ts.
  const { data: rawMembers, error: memErr } = await db
    .from('tracked_point_member')
    .select('subject_thread_id')
    .eq('status', 'active')
    .in('subject_thread_id', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (memErr) throw memErr
  const alreadyTrackedThreadIds = new Set((rawMembers ?? []).map((m) => m.subject_thread_id))

  const { data: rawFounders, error: founderErr } = await db
    .from('tracked_point')
    .select('founding_reference')
    .eq('site_id', siteId)
    .in('founding_reference', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (founderErr) throw founderErr
  for (const f of rawFounders ?? []) {
    if (f.founding_reference) alreadyTrackedThreadIds.add(f.founding_reference)
  }

  return buildPendingTrackabilityQueue(
    siteId,
    traces,
    evidenceProposalIdsByTrace,
    sourceProposalsByThread,
    subjectIdByThreadId,
    subjectLabelBySubjectId,
    alreadyTrackedThreadIds,
  )
}
