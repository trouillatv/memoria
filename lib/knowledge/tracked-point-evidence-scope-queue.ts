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
// kind filtré explicitement (P6, BLOCKER 1) — IDENTITY_UNRESOLVED (migration 401,
// fn_reconcile_tracked_point_unit) hérite lui aussi de evidence_status='unresolved' par défaut
// (colonne créée par la migration 394, avant l'existence de ce kind) mais N'A PAS sa place ici :
// sa décision humaine est "quel Point est-ce ?" (tracked_point_identity_candidate, déjà servie
// par loadTraceIdentityQueue / catégorie attach_information, déjà câblée sur
// acceptTraceIdentityCandidate/rejectTraceIdentityCandidate), jamais "quelle preuve ?". Sans ce
// filtre, resolvePendingEvidenceScope (qui n'a aucun guard de kind) accepterait de la "résoudre"
// côté preuve — masquant silencieusement la vraie question d'identité jamais tranchée.
//
// Vocabulaire backend volontairement en `proposalIds`, jamais en langage métier — la mise en
// mots pour un futur écran ("Laquelle correspond à ce qu'il faut suivre ?") est un problème
// d'UI (6E.4, hors périmètre), pas de ce read-model.
//
// P0-1A-2b — famille native (site_knowledge_proposals) ajoutée comme seconde source de
// candidats, à parité avec document_extraction_proposal. Contrairement à l'historique
// (subject_thread_id = clé directe), une proposition native ne porte que son
// canonical_subject_id BRUT (pré-fusion possible) : la mise en correspondance avec un thread
// (déjà une racine post-fusion, cf. source_thread_id des pending traces) passe par
// canonical_subject_occurrence (mig 291, source_proposal_id) + la même résolution de racine que
// l'adaptateur natif (lib/db/tracked-point-live-writer-native-adapter.ts:makeSubjectResolver,
// dupliquée ici par la même doctrine self-contained). kind='stakeholder' exclu par construction
// (hors périmètre, mandat 2b) — jamais un filtre sur canonical_resolution_status/status (cf.
// doctrine 2a : ces colonnes décrivent le cycle de la proposition, jamais l'état réel).

import { createAdminClient } from '@/lib/supabase/admin'
import { pendingTraceVisibleFilter } from '@/lib/db/tracked-point-pending-resolution'

type Db = ReturnType<typeof createAdminClient>
type SubjectRow = { id: string; merged_into: string | null }

function makeSubjectRootResolver(db: Db, siteId: string) {
  const cache = new Map<string, SubjectRow>()

  async function ensureLoaded(id: string): Promise<void> {
    if (cache.has(id)) return
    const { data } = await db
      .from('canonical_subject')
      .select('id, merged_into')
      .eq('site_id', siteId)
      .eq('id', id)
      .maybeSingle()
    if (data) cache.set(id, data as SubjectRow)
  }

  return async function resolveRoot(id: string): Promise<string | null> {
    let cur = id
    const seen = new Set<string>()
    while (!seen.has(cur)) {
      seen.add(cur)
      await ensureLoaded(cur)
      const row = cache.get(cur)
      if (!row?.merged_into) return cur
      cur = row.merged_into
    }
    return cur
  }
}

export type EvidenceScopeCandidateProposal = {
  proposalId: string
  family: string
  label: string | null
  documentStatus: string | null
  documentId: string | null
  documentFilename: string | null
  documentType: string | null
  documentEffectiveDate: string | null
  sourcePage: number | null
  sourceExcerpt: string | null
  hasVerbatimExcerpt: boolean
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
    .in('kind', ['TRACKABILITY_UNDETERMINED', 'RESOLUTION_WITHOUT_KNOWN_PROBLEM'])
    .or(pendingTraceVisibleFilter(new Date().toISOString()))
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
    .select('id, subject_thread_id, proposal_family, label, document_status, document_id, source_page, source_excerpt, created_at')
    .in('subject_thread_id', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (propErr) throw propErr

  const documentIds = [...new Set((rawProposals ?? []).map((p) => p.document_id).filter((id): id is string => !!id))]
  const { data: rawDocuments, error: docErr } = await db
    .from('documents')
    .select('id, filename, document_type, effective_date')
    .in('id', documentIds.length > 0 ? documentIds : [NIL_UUID])
  if (docErr) throw docErr
  const documentsById = new Map((rawDocuments ?? []).map((d) => [d.id, d]))

  const proposalsByThreadId = new Map<string, EvidenceScopeCandidateProposal[]>()
  for (const p of rawProposals ?? []) {
    const doc = p.document_id ? documentsById.get(p.document_id) : undefined
    const list = proposalsByThreadId.get(p.subject_thread_id) ?? []
    const sourceExcerpt = p.source_excerpt?.trim() || null
    list.push({
      proposalId: p.id,
      family: p.proposal_family,
      label: p.label,
      documentStatus: p.document_status,
      documentId: p.document_id,
      documentFilename: doc?.filename ?? null,
      documentType: doc?.document_type ?? null,
      documentEffectiveDate: doc?.effective_date ?? null,
      sourcePage: p.source_page ?? null,
      sourceExcerpt,
      hasVerbatimExcerpt: sourceExcerpt !== null,
      createdAt: p.created_at,
      alreadySelected: false,
    })
    proposalsByThreadId.set(p.subject_thread_id, list)
  }

  // Famille native (P0-1A-2b) : canonical_subject_occurrence (mig 291) donne le pont
  // proposal→sujet brut ; racine résolue via la même convention forward (merged_into) que
  // l'adaptateur natif, jamais l'inverse (pas de remontée d'arbre depuis la racine).
  const { data: rawOccurrences, error: occErr } = await db
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, source_proposal_id')
    .eq('site_id', siteId)
    .not('source_proposal_id', 'is', null)
  if (occErr) throw occErr

  const resolveRoot = makeSubjectRootResolver(db, siteId)
  const threadIdSet = new Set(threadIds)
  const nativeProposalIdsByThread = new Map<string, Set<string>>()
  for (const occ of (rawOccurrences ?? []) as Array<{ canonical_subject_id: string; source_proposal_id: string | null }>) {
    if (!occ.source_proposal_id) continue
    const root = await resolveRoot(occ.canonical_subject_id)
    if (!root || !threadIdSet.has(root)) continue
    const set = nativeProposalIdsByThread.get(root) ?? new Set<string>()
    set.add(occ.source_proposal_id)
    nativeProposalIdsByThread.set(root, set)
  }

  const nativeCandidateIds = [...new Set([...nativeProposalIdsByThread.values()].flatMap((s) => [...s]))]
  if (nativeCandidateIds.length > 0) {
    const { data: rawNativeProposals, error: nativeErr } = await db
      .from('site_knowledge_proposals')
      .select('id, kind, title, body, created_at')
      .in('id', nativeCandidateIds)
    if (nativeErr) throw nativeErr
    const nativeProposalsById = new Map(
      ((rawNativeProposals ?? []) as Array<{ id: string; kind: string; title: string | null; body: string | null; created_at: string | null }>)
        .filter((p) => p.kind !== 'stakeholder')
        .map((p) => [p.id, p]),
    )

    for (const [threadId, ids] of nativeProposalIdsByThread) {
      const list = proposalsByThreadId.get(threadId) ?? []
      for (const id of ids) {
        const p = nativeProposalsById.get(id)
        if (!p) continue
        const sourceExcerpt = p.body?.trim() || null
        list.push({
          proposalId: p.id,
          family: p.kind,
          label: p.title,
          documentStatus: null,
          documentId: null,
          documentFilename: null,
          documentType: null,
          documentEffectiveDate: null,
          sourcePage: null,
          sourceExcerpt,
          hasVerbatimExcerpt: sourceExcerpt !== null,
          createdAt: p.created_at,
          alreadySelected: false,
        })
      }
      proposalsByThreadId.set(threadId, list)
    }
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
