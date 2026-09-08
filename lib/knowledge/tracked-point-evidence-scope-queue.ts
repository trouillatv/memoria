// Phase 6E.3C.1 — read-model de sélection humaine de portée de preuve (mandat Vincent : "une
// unité par pending trace evidence_status=unresolved, avec ses propositions sélectionnables").
// Même convention pure/async que tracked-point-pending-resolution-queue.ts et
// tracked-point-trace-queue.ts : buildEvidenceScopeQueue (pur) + loadEvidenceScopeQueue (async).
// AUCUNE écriture, AUCUN LLM, AUCUNE présélection — proposals[].alreadySelected est TOUJOURS
// false ici (même proposal_family, même label, même canonical_subject ne présélectionnent
// jamais rien ; le choix est entièrement humain, cf. resolvePendingEvidenceScope).
//
// Portée : les 165 pending traces status='pending' AND evidence_status='unresolved' (43
// TRACKABILITY_UNDETERMINED + 122 RESOLUTION_WITHOUT_KNOWN_PROBLEM) — exactement les pending
// traces que resolvePendingEvidenceScope accepte (même filtre status/evidence_status que son
// propre guard live), jamais une trace déjà résolue ou dismissed.
//
// Vocabulaire backend volontairement en `proposalIds`, jamais en langage métier — la mise en
// mots pour un futur écran ("Laquelle correspond à ce qu'il faut suivre ?") est un problème
// d'UI (6E.4, hors périmètre), pas de ce read-model.

import { createAdminClient } from '@/lib/supabase/admin'

export type EvidenceScopeCandidateProposal = {
  proposalId: string
  family: string
  label: string | null
  documentStatus: string | null
  documentId: string | null
  documentFilename: string | null
  documentType: string | null
  createdAt: string | null
  alreadySelected: false
}

export type EvidenceScopeQueueEntry = {
  pendingTraceId: string
  kind: string
  sourceThreadId: string
  siteId: string
  subjectId: string | null
  subjectLabel: string | null
  reason: string | null
  createdAt: string | null
  proposals: EvidenceScopeCandidateProposal[]
  proposalCount: number
}

export type EvidenceScopeQueue = {
  siteId: string
  entries: EvidenceScopeQueueEntry[]
  totalEntries: number
}

export type EvidenceScopePendingTraceRow = {
  id: string
  kind: string
  sourceThreadId: string
  siteId: string
  reason: string | null
  createdAt: string | null
}

// buildEvidenceScopeQueue : pur. N'accepte que des traces déjà filtrées status='pending' AND
// evidence_status='unresolved' par l'appelant (même convention que buildPendingResolutionQueue).
export function buildEvidenceScopeQueue(
  siteId: string,
  traces: EvidenceScopePendingTraceRow[],
  proposalsByThreadId: Map<string, EvidenceScopeCandidateProposal[]>,
  subjectIdByThreadId: Map<string, string | null>,
  subjectLabelBySubjectId: Map<string, string | null>,
): EvidenceScopeQueue {
  const entries: EvidenceScopeQueueEntry[] = traces.map((trace) => {
    const proposals = proposalsByThreadId.get(trace.sourceThreadId) ?? []
    const subjectId = subjectIdByThreadId.get(trace.sourceThreadId) ?? null
    return {
      pendingTraceId: trace.id,
      kind: trace.kind,
      sourceThreadId: trace.sourceThreadId,
      siteId: trace.siteId,
      subjectId,
      subjectLabel: subjectId ? (subjectLabelBySubjectId.get(subjectId) ?? null) : null,
      reason: trace.reason,
      createdAt: trace.createdAt,
      proposals,
      proposalCount: proposals.length,
    }
  })

  return { siteId, entries, totalEntries: entries.length }
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export async function loadEvidenceScopeQueue(siteId: string): Promise<EvidenceScopeQueue> {
  const db = createAdminClient()

  const { data: rawTraces, error: tracesErr } = await db
    .from('tracked_point_pending_trace')
    .select('id, kind, source_thread_id, site_id, reason, created_at')
    .eq('site_id', siteId)
    .eq('status', 'pending')
    .eq('evidence_status', 'unresolved')
  if (tracesErr) throw tracesErr

  const traces: EvidenceScopePendingTraceRow[] = (rawTraces ?? []).map((t) => ({
    id: t.id,
    kind: t.kind,
    sourceThreadId: t.source_thread_id,
    siteId: t.site_id,
    reason: t.reason,
    createdAt: t.created_at,
  }))
  const threadIds = [...new Set(traces.map((t) => t.sourceThreadId))]

  const { data: rawProposals, error: propErr } = await db
    .from('document_extraction_proposal')
    .select('id, subject_thread_id, proposal_family, label, document_status, document_id, created_at')
    .in('subject_thread_id', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (propErr) throw propErr

  const documentIds = [...new Set((rawProposals ?? []).map((p) => p.document_id).filter((id): id is string => !!id))]
  const { data: rawDocuments, error: docErr } = await db
    .from('documents')
    .select('id, filename, document_type')
    .in('id', documentIds.length > 0 ? documentIds : [NIL_UUID])
  if (docErr) throw docErr
  const documentsById = new Map((rawDocuments ?? []).map((d) => [d.id, d]))

  const proposalsByThreadId = new Map<string, EvidenceScopeCandidateProposal[]>()
  for (const p of rawProposals ?? []) {
    const doc = p.document_id ? documentsById.get(p.document_id) : undefined
    const list = proposalsByThreadId.get(p.subject_thread_id) ?? []
    list.push({
      proposalId: p.id,
      family: p.proposal_family,
      label: p.label,
      documentStatus: p.document_status,
      documentId: p.document_id,
      documentFilename: doc?.filename ?? null,
      documentType: doc?.document_type ?? null,
      createdAt: p.created_at,
      alreadySelected: false,
    })
    proposalsByThreadId.set(p.subject_thread_id, list)
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

  return buildEvidenceScopeQueue(siteId, traces, proposalsByThreadId, subjectIdByThreadId, subjectLabelBySubjectId)
}
