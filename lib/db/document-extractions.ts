// Modèle générique des propositions documentaires multimodales (migration 257).
//
// Ce module gère le cycle de vie d'une extraction :
//   run → proposals + evidence → relations M-M → validation humaine → matérialisation
//
// Invariants imposés ICI (pas en SQL seul) :
//   (6) une proposition refusée ne peut pas être matérialisée
//   (7) une proposition déjà matérialisée ne recrée pas le même objet (UNIQUE DB)
//
// L'extraction LLM réelle est hors périmètre de ce fichier (Sprint 4B.1).

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  DbDocumentExtractionRun,
  DbDocumentExtractionProposal,
  DbDocumentExtractionEvidence,
  DbDocumentProposalMaterialization,
  DocumentExtractionProposalWithEvidence,
  DocumentExtractionRunStatus,
  DocumentProposalFamily,
  DocumentProposalReviewStatus,
  DocumentEvidenceType,
  DocumentEvidenceRelationType,
} from '@/types/db'

// ── Exécution ────────────────────────────────────────────────────────────────

export async function createExtractionRun(input: {
  document_id: string
  organization_id: string
  extractor_key: string
  extractor_version?: string
  target_site_id?: string
  created_by?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('document_extraction_run')
    .insert({
      document_id: input.document_id,
      organization_id: input.organization_id,
      extractor_key: input.extractor_key,
      extractor_version: input.extractor_version ?? '1.0.0',
      target_site_id: input.target_site_id ?? null,
      status: 'pending' as DocumentExtractionRunStatus,
      created_by: input.created_by ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

export async function updateExtractionStage(runId: string, stage: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('document_extraction_run').update({ current_stage: stage }).eq('id', runId)
}

export async function updateExtractionRunStatus(
  runId: string,
  status: DocumentExtractionRunStatus,
  extra?: {
    error_message?: string
    completed_at?: string
    started_at?: string
    extracted_text_length?: number | null
    empty_reason?: import('@/types/db').DocumentExtractionEmptyReason | null
  },
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('document_extraction_run')
    .update({
      status,
      ...(extra?.error_message !== undefined ? { error_message: extra.error_message } : {}),
      ...(extra?.completed_at !== undefined ? { completed_at: extra.completed_at } : {}),
      ...(extra?.started_at !== undefined ? { started_at: extra.started_at } : {}),
      ...(extra?.extracted_text_length !== undefined ? { extracted_text_length: extra.extracted_text_length } : {}),
      ...(extra?.empty_reason !== undefined ? { empty_reason: extra.empty_reason } : {}),
    })
    .eq('id', runId)
  if (error) throw new Error(error.message)
}

// ── Propositions ─────────────────────────────────────────────────────────────

export async function insertExtractionProposals(
  runId: string,
  proposals: Array<{
    organization_id: string
    document_id: string
    target_site_id?: string | null
    proposal_family: DocumentProposalFamily
    stable_key?: string | null
    label: string
    description?: string | null
    source_page?: number | null
    source_excerpt?: string | null
    source_payload?: Record<string, unknown> | null
    thematic_category?: string | null
    document_status?: string | null
  }>,
): Promise<string[]> {
  if (proposals.length === 0) return []
  const supabase = createAdminClient()
  const rows = proposals.map((p) => ({
    extraction_run_id: runId,
    organization_id: p.organization_id,
    document_id: p.document_id,
    target_site_id: p.target_site_id ?? null,
    proposal_family: p.proposal_family,
    stable_key: p.stable_key ?? null,
    label: p.label,
    description: p.description ?? null,
    source_page: p.source_page ?? null,
    source_excerpt: p.source_excerpt ?? null,
    source_payload: p.source_payload ?? null,
    thematic_category: p.thematic_category ?? null,
    document_status: p.document_status ?? null,
    review_status: 'pending' as DocumentProposalReviewStatus,
  }))
  const { data, error } = await supabase
    .from('document_extraction_proposal')
    .insert(rows)
    .select('id')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

// ── Preuves ──────────────────────────────────────────────────────────────────

export async function insertExtractionEvidence(
  runId: string,
  items: Array<{
    organization_id: string
    document_id: string
    evidence_type: DocumentEvidenceType
    source_page?: number | null
    storage_path?: string | null
    caption?: string | null
    nearby_text?: string | null
    metadata?: Record<string, unknown> | null
  }>,
): Promise<Array<{ id: string; storage_path: string | null }>> {
  if (items.length === 0) return []
  const supabase = createAdminClient()
  const rows = items.map((e) => ({
    extraction_run_id: runId,
    organization_id: e.organization_id,
    document_id: e.document_id,
    evidence_type: e.evidence_type,
    source_page: e.source_page ?? null,
    storage_path: e.storage_path ?? null,
    caption: e.caption ?? null,
    nearby_text: e.nearby_text ?? null,
    metadata: e.metadata ?? null,
  }))
  const { data, error } = await supabase
    .from('document_extraction_evidence')
    .insert(rows)
    .select('id, storage_path')
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ id: string; storage_path: string | null }>
}

// BATCH-3 — primitive partagée UI/batch : épingler automatiquement tous les
// visuels pertinents d'un run pour la fiche visite, avec la même règle de
// priorité que pinAllSnapshotsAction (review-actions.ts) : image native
// retenue systématiquement, snapshot de page retenu SEULEMENT en fallback
// pour une page sans image native. Extraite pour que le batch réutilise
// exactement cette règle sans la dupliquer. Ne touche jamais aux relations
// document_proposal_evidence (candidate/illustrates) — épingler ≠ confirmer
// qu'une photo illustre un objet précis.
export async function pinAllSnapshotsForRun(
  runId: string,
): Promise<{ pinnedNative: number; pinnedFallback: number }> {
  const supabase = createAdminClient()

  const { data: run } = await supabase
    .from('document_extraction_run')
    .select('document_id, target_site_id')
    .eq('id', runId)
    .maybeSingle()
  if (!run) return { pinnedNative: 0, pinnedFallback: 0 }
  const { document_id: documentId, target_site_id: targetSiteId } = run as {
    document_id: string
    target_site_id: string | null
  }

  const { data: allVisual } = await supabase
    .from('document_extraction_evidence')
    .select('id, source_page, evidence_type')
    .eq('extraction_run_id', runId)
    .in('evidence_type', ['page_snapshot', 'image'])

  if (!allVisual?.length) return { pinnedNative: 0, pinnedFallback: 0 }

  const pagesWithImages = new Set(
    allVisual.filter((e) => e.evidence_type === 'image').map((e) => e.source_page),
  )
  const nativeToPin = allVisual.filter((e) => e.evidence_type === 'image')
  const fallbackToPin = allVisual.filter((e) => e.evidence_type === 'page_snapshot' && !pagesWithImages.has(e.source_page))
  const toUnpin = allVisual.filter((e) => e.evidence_type === 'page_snapshot' && pagesWithImages.has(e.source_page))

  const toPinIds = [...nativeToPin, ...fallbackToPin].map((e) => e.id)
  if (toPinIds.length > 0) {
    const { error } = await supabase.from('document_extraction_evidence').update({ pinned_for_visit: true }).in('id', toPinIds)
    if (error) throw new Error(error.message)
  }
  if (toUnpin.length > 0) {
    const { error } = await supabase.from('document_extraction_evidence').update({ pinned_for_visit: false }).in('id', toUnpin.map((e) => e.id))
    if (error) throw new Error(error.message)
  }

  // Re-lier la visite existante au run courant pour que revue et fiche partagent
  // le même extraction_run_id (une ré-extraction crée un nouveau run mais la visite
  // stocke toujours l'ancien).
  if (targetSiteId) {
    const { data: allDocRuns } = await supabase
      .from('document_extraction_run')
      .select('id')
      .eq('document_id', documentId)
    const docRunIds = (allDocRuns ?? []).map((r: { id: string }) => r.id)
    if (docRunIds.length > 0) {
      const { error } = await supabase
        .from('site_reports')
        .update({ extraction_run_id: runId })
        .eq('site_id', targetSiteId)
        .in('extraction_run_id', docRunIds)
      if (error) throw new Error(error.message)
    }
  }

  return { pinnedNative: nativeToPin.length, pinnedFallback: fallbackToPin.length }
}

// ── Relations M-M (idempotentes) ─────────────────────────────────────────────

export async function linkProposalEvidence(
  proposalId: string,
  evidenceId: string,
  relationType: DocumentEvidenceRelationType,
  confidence?: number | null,
  skipIfExists?: boolean,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('document_proposal_evidence')
    .upsert(
      {
        proposal_id: proposalId,
        evidence_id: evidenceId,
        relation_type: relationType,
        confidence: confidence ?? null,
      },
      { onConflict: 'proposal_id,evidence_id', ignoreDuplicates: skipIfExists ?? false },
    )
  if (error) throw new Error(error.message)
}

// ── Lecture pour révision ─────────────────────────────────────────────────────

export async function listExtractionForReview(
  runId: string,
): Promise<DocumentExtractionProposalWithEvidence[]> {
  const supabase = createAdminClient()

  const { data: proposals, error: pErr } = await supabase
    .from('document_extraction_proposal')
    .select('*')
    .eq('extraction_run_id', runId)
    .order('created_at', { ascending: true })
  if (pErr) throw new Error(pErr.message)

  if (!proposals || proposals.length === 0) return []
  const proposalIds = (proposals as DbDocumentExtractionProposal[]).map((p) => p.id)

  const [{ data: relations, error: rErr }, { data: mats, error: mErr }] = await Promise.all([
    supabase
      .from('document_proposal_evidence')
      .select('proposal_id, evidence_id, relation_type, confidence, document_extraction_evidence(*)')
      .in('proposal_id', proposalIds),
    supabase
      .from('document_proposal_materialization')
      .select('*')
      .in('proposal_id', proposalIds),
  ])
  if (rErr) throw new Error(rErr.message)
  if (mErr) throw new Error(mErr.message)

  const relationsByProposal = new Map<string, typeof relations>()
  for (const rel of relations ?? []) {
    const pid = (rel as { proposal_id: string }).proposal_id
    if (!relationsByProposal.has(pid)) relationsByProposal.set(pid, [])
    relationsByProposal.get(pid)!.push(rel)
  }

  const matsByProposal = new Map<string, DbDocumentProposalMaterialization[]>()
  for (const mat of (mats ?? []) as DbDocumentProposalMaterialization[]) {
    if (!matsByProposal.has(mat.proposal_id)) matsByProposal.set(mat.proposal_id, [])
    matsByProposal.get(mat.proposal_id)!.push(mat)
  }

  return (proposals as DbDocumentExtractionProposal[]).map((proposal) => ({
    proposal,
    evidence: (relationsByProposal.get(proposal.id) ?? []).map((rel) => ({
      evidence: (rel as unknown as { document_extraction_evidence: DbDocumentExtractionEvidence }).document_extraction_evidence,
      relationType: (rel as { relation_type: DocumentEvidenceRelationType }).relation_type,
      confidence: (rel as { confidence: number | null }).confidence,
    })),
    materializations: matsByProposal.get(proposal.id) ?? [],
  }))
}

// ── Validation humaine ────────────────────────────────────────────────────────

export type ReviewAction =
  | { action: 'accept' }
  | { action: 'reject' }
  | { action: 'reset' } // retour à pending — Réexaminer
  | {
      action: 'edit'
      label: string
      description?: string | null
      family?: DocumentProposalFamily
    }

export async function reviewProposal(
  proposalId: string,
  review: ReviewAction,
  reviewedBy?: string | null,
): Promise<void> {
  const supabase = createAdminClient()

  // Vérifier le statut actuel (invariant 6 : un refus ne peut être matérialisé)
  const { data: current, error: fetchErr } = await supabase
    .from('document_extraction_proposal')
    .select('review_status')
    .eq('id', proposalId)
    .single()
  if (fetchErr) throw new Error(fetchErr.message)
  const status = (current as { review_status: DocumentProposalReviewStatus }).review_status
  if (status === 'materialized') {
    throw new Error(`Proposition ${proposalId} déjà matérialisée — révision impossible.`)
  }

  const now = new Date().toISOString()
  let patch: Partial<DbDocumentExtractionProposal>

  if (review.action === 'reject') {
    patch = { review_status: 'rejected', reviewed_at: now, reviewed_by: reviewedBy ?? null }
  } else if (review.action === 'reset') {
    patch = { review_status: 'pending', reviewed_at: now, reviewed_by: reviewedBy ?? null }
  } else if (review.action === 'accept') {
    patch = { review_status: 'accepted', reviewed_at: now, reviewed_by: reviewedBy ?? null }
  } else {
    patch = {
      review_status: 'edited',
      reviewed_label: review.label,
      reviewed_description: review.description ?? null,
      reviewed_family: review.family ?? null,
      reviewed_at: now,
      reviewed_by: reviewedBy ?? null,
    }
  }

  const { error } = await supabase
    .from('document_extraction_proposal')
    .update(patch)
    .eq('id', proposalId)
  if (error) throw new Error(error.message)
}

// BATCH-0 — primitive partagée UI/batch : accepter en masse toutes les
// propositions `pending` d'un run. Extraite de acceptAllPendingAction
// (review-actions.ts) pour éviter que le futur orchestrateur batch ne
// reproduise cette UPDATE dans un script séparé.
export async function acceptAllPendingForRun(input: {
  runId: string
  userId: string
}): Promise<{ ok: boolean; count?: number; error?: string }> {
  const { runId, userId } = input
  const supabase = createAdminClient()

  const { data: pending } = await supabase
    .from('document_extraction_proposal')
    .select('id')
    .eq('extraction_run_id', runId)
    .eq('review_status', 'pending')

  if (!pending?.length) return { ok: true, count: 0 }

  const { error } = await supabase
    .from('document_extraction_proposal')
    .update({ review_status: 'accepted', reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq('extraction_run_id', runId)
    .eq('review_status', 'pending')

  if (error) return { ok: false, error: error.message }
  return { ok: true, count: pending.length }
}

// ── Matérialisation (registre idempotent) ────────────────────────────────────

export async function recordMaterialization(input: {
  organization_id: string
  proposal_id: string
  target_entity_type: string
  target_entity_id: string
  created_by?: string | null
}): Promise<void> {
  const supabase = createAdminClient()

  // Invariant 6 : un refus ne peut être matérialisé
  const { data: proposal, error: pErr } = await supabase
    .from('document_extraction_proposal')
    .select('review_status')
    .eq('id', input.proposal_id)
    .single()
  if (pErr) throw new Error(pErr.message)
  const reviewStatus = (proposal as { review_status: DocumentProposalReviewStatus }).review_status
  if (reviewStatus === 'rejected') {
    throw new Error(`Proposition ${input.proposal_id} refusée — matérialisation impossible.`)
  }

  // Invariant 7 : idempotence via UNIQUE (proposal_id, target_entity_type, target_entity_id)
  const { error } = await supabase
    .from('document_proposal_materialization')
    .upsert(
      {
        organization_id: input.organization_id,
        proposal_id: input.proposal_id,
        target_entity_type: input.target_entity_type,
        target_entity_id: input.target_entity_id,
        status: 'done',
        created_by: input.created_by ?? null,
      },
      { onConflict: 'proposal_id,target_entity_type,target_entity_id', ignoreDuplicates: true },
    )
  if (error) throw new Error(error.message)

  // Mettre à jour le statut de la proposition
  await supabase
    .from('document_extraction_proposal')
    .update({ review_status: 'materialized' })
    .eq('id', input.proposal_id)
}

// ── Requêtes pour l'interface de revue ───────────────────────────────────────

export async function getExtractionRun(
  runId: string,
): Promise<DbDocumentExtractionRun | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('document_extraction_run')
    .select('*')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as DbDocumentExtractionRun | null)
}

export async function getLatestExtractionRunForDocument(
  documentId: string,
): Promise<DbDocumentExtractionRun | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('document_extraction_run')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as DbDocumentExtractionRun | null)
}

export async function listOrphanEvidenceForRun(
  runId: string,
): Promise<DbDocumentExtractionEvidence[]> {
  const supabase = createAdminClient()

  const { data: allEvidence, error: evErr } = await supabase
    .from('document_extraction_evidence')
    .select('*')
    .eq('extraction_run_id', runId)
  if (evErr) throw new Error(evErr.message)
  if (!allEvidence || allEvidence.length === 0) return []

  const all = allEvidence as DbDocumentExtractionEvidence[]
  const evidenceIds = all.map((e) => e.id)

  // Un lien 'candidate' (suggestion par page) ne compte pas comme "liée" :
  // la preuve reste visible pour confirmation manuelle dans l'interface.
  const { data: linked, error: linkErr } = await supabase
    .from('document_proposal_evidence')
    .select('evidence_id')
    .in('evidence_id', evidenceIds)
    .neq('relation_type', 'candidate')
  if (linkErr) throw new Error(linkErr.message)

  const linkedIds = new Set((linked ?? []).map((r: { evidence_id: string }) => r.evidence_id))
  return all.filter((e) => !linkedIds.has(e.id))
}

export async function listCandidateLinksForRun(runId: string): Promise<Array<{
  evidence_id: string
  proposal_id: string
  confidence: number | null
  proposal_label: string
  proposal_family: string
}>> {
  const supabase = createAdminClient()

  const { data: allEvidence, error: evErr } = await supabase
    .from('document_extraction_evidence')
    .select('id')
    .eq('extraction_run_id', runId)
  if (evErr || !allEvidence?.length) return []

  const evidenceIds = (allEvidence as Array<{ id: string }>).map((e) => e.id)

  // Charger candidates ET dismissed en une seule requête pour filtrer côté client.
  // Un lien 'dismissed' sur le même couple (evidence_id, proposal_id) masque le 'candidate'
  // correspondant pour éviter de reproposer un lien déjà refusé par l'humain.
  const { data, error } = await supabase
    .from('document_proposal_evidence')
    .select('evidence_id, proposal_id, relation_type, confidence, document_extraction_proposal(label, reviewed_label, proposal_family)')
    .in('relation_type', ['candidate', 'dismissed'])
    .in('evidence_id', evidenceIds)
  if (error) throw new Error(error.message)

  type Row = {
    evidence_id: string
    proposal_id: string
    relation_type: string
    confidence: number | null
    document_extraction_proposal: { label: string; reviewed_label: string | null; proposal_family: string } | null
  }

  const rows = (data ?? []) as unknown as Row[]
  const dismissedKeys = new Set(
    rows.filter((r) => r.relation_type === 'dismissed').map((r) => `${r.evidence_id}:${r.proposal_id}`),
  )

  return rows
    .filter((r) => r.relation_type === 'candidate'
      && !dismissedKeys.has(`${r.evidence_id}:${r.proposal_id}`)
      && r.document_extraction_proposal !== null)
    .map((r) => ({
      evidence_id: r.evidence_id,
      proposal_id: r.proposal_id,
      confidence: r.confidence,
      proposal_label: r.document_extraction_proposal!.reviewed_label ?? r.document_extraction_proposal!.label,
      proposal_family: r.document_extraction_proposal!.proposal_family,
    }))
}

export async function getIllustratesLinksForRun(runId: string): Promise<Array<{
  proposal_id: string
  evidence_id: string
  caption: string | null
  storage_path: string | null
  source_page: number | null
  proposal_label: string | null
  pinned_for_visit: boolean
}>> {
  const supabase = createAdminClient()

  const { data: evs, error: evErr } = await supabase
    .from('document_extraction_evidence')
    .select('id')
    .eq('extraction_run_id', runId)
    .eq('evidence_type', 'image')
  if (evErr || !evs?.length) return []

  const evIds = (evs as Array<{ id: string }>).map((e) => e.id)

  const { data, error } = await supabase
    .from('document_proposal_evidence')
    .select('proposal_id, evidence_id, document_extraction_evidence(caption, storage_path, source_page, pinned_for_visit), document_extraction_proposal(label, reviewed_label)')
    .eq('relation_type', 'illustrates')
    .in('evidence_id', evIds)
  if (error) return []

  type Row = {
    proposal_id: string
    evidence_id: string
    document_extraction_evidence: { caption: string | null; storage_path: string | null; source_page: number | null; pinned_for_visit: boolean } | null
    document_extraction_proposal: { label: string; reviewed_label: string | null } | null
  }

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    proposal_id: r.proposal_id,
    evidence_id: r.evidence_id,
    caption: r.document_extraction_evidence?.caption ?? null,
    storage_path: r.document_extraction_evidence?.storage_path ?? null,
    source_page: r.document_extraction_evidence?.source_page ?? null,
    pinned_for_visit: r.document_extraction_evidence?.pinned_for_visit ?? false,
    proposal_label: r.document_extraction_proposal?.reviewed_label ?? r.document_extraction_proposal?.label ?? null,
  }))
}

export type RunWithDocDate = {
  id: string
  document_id: string
  created_at: string
  /** Date métier du PV (documents.effective_date). Null si non renseignée. */
  documentEffectiveDate: string | null
}

/**
 * Retourne les `limit` derniers PV canoniques du chantier, ordonnés par
 * documents.effective_date ASC (temps métier, pas temps d'extraction).
 *
 * Filtre par is_canonical = true : 1 document = 1 snapshot, les re-analyses
 * du même PDF n'apparaissent pas comme des PV distincts (migration 276).
 * Filtre également documents.deleted_at IS NULL : les runs dont le document
 * parent a été soft-deleted ne participent jamais au comparateur.
 */
export async function getLatestRunsForSite(
  siteId: string,
  limit = 2,
): Promise<RunWithDocDate[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('document_extraction_run')
    .select('id, document_id, created_at, documents!document_id(effective_date, deleted_at)')
    .eq('target_site_id', siteId)
    .eq('is_canonical', true)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  type Raw = { id: string; document_id: string; created_at: string; documents: Array<{ effective_date: string | null; deleted_at: string | null }> | { effective_date: string | null; deleted_at: string | null } | null }
  const rows = ((data ?? []) as unknown as Raw[]).filter((r) => {
    const doc = Array.isArray(r.documents) ? r.documents[0] : r.documents
    return doc?.deleted_at == null
  })

  function docEffDate(r: Raw): string {
    const doc = Array.isArray(r.documents) ? r.documents[0] : r.documents
    return doc?.effective_date ?? r.created_at
  }

  rows.sort((a, b) => {
    const dateA = docEffDate(a)
    const dateB = docEffDate(b)
    return dateA !== dateB ? dateA.localeCompare(dateB) : a.created_at.localeCompare(b.created_at)
  })

  return rows.slice(-limit).map((r) => ({
    id: r.id,
    document_id: r.document_id,
    created_at: r.created_at,
    documentEffectiveDate: (Array.isArray(r.documents) ? r.documents[0] : r.documents)?.effective_date ?? null,
  }))
}

// ── Bilan de complétude (batch) ───────────────────────────────────────────────

export interface ProposalMaterializationReport {
  totalExtracted: number
  autoAccepted: number
  rejectedByGuard: number
  materialized: number
}

/**
 * Compte APRÈS matérialisation : une garde déterministe (ex. isSiteEstablishmentLabel
 * dans materializeHistoricalRun, famille 'company') peut encore rejeter une proposition
 * déjà acceptée par acceptAllPendingForRun. Dans le flux batch, aucun rejet humain
 * (rejectProposalAction) n'intervient jamais — un review_status='rejected' à ce stade
 * reflète donc toujours cette garde, jamais une revue manuelle.
 */
export async function getProposalMaterializationReport(
  runId: string,
): Promise<ProposalMaterializationReport> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('document_extraction_proposal')
    .select('review_status')
    .eq('extraction_run_id', runId)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as Array<{ review_status: DocumentProposalReviewStatus }>
  return {
    totalExtracted: rows.length,
    autoAccepted: rows.filter((r) => r.review_status !== 'pending').length,
    rejectedByGuard: rows.filter((r) => r.review_status === 'rejected').length,
    materialized: rows.filter((r) => r.review_status === 'materialized').length,
  }
}

export interface PhotoMaterializationReport {
  detected: number
  nativeRetained: number
  snapshotFallbackRetained: number
  integratedToVisit: number
  illustratesConfirmed: number
  candidatesRemaining: number
  dismissed: number
  lostSilently: number
}

/**
 * Épinglage (pinned_for_visit) et confirmation d'association (illustrates) sont deux
 * gestes distincts (doctrine batch) : ce rapport ne doit jamais laisser croire que
 * l'un implique l'autre. `integratedToVisit` vient de visit_capture (matérialisation
 * RPC, indépendante du pin/candidate) ; `illustratesConfirmed`/`candidatesRemaining`/
 * `dismissed` viennent de document_proposal_evidence (PK binaire proposal_id/evidence_id
 * depuis la migration 265 — un couple ne peut porter qu'un seul relation_type à la fois).
 */
export async function getPhotoMaterializationReport(
  runId: string,
  siteReportId: string | null,
): Promise<PhotoMaterializationReport> {
  const supabase = createAdminClient()

  const { data: evidenceRows, error: evErr } = await supabase
    .from('document_extraction_evidence')
    .select('id, evidence_type, pinned_for_visit, storage_path')
    .eq('extraction_run_id', runId)
    .in('evidence_type', ['image', 'page_snapshot'])
  if (evErr) throw new Error(evErr.message)

  const evidence = (evidenceRows ?? []) as Array<{
    id: string
    evidence_type: DocumentEvidenceType
    pinned_for_visit: boolean
    storage_path: string | null
  }>

  const detected = evidence.length
  const nativeRetained = evidence.filter((e) => e.evidence_type === 'image' && e.pinned_for_visit).length
  const snapshotFallbackRetained = evidence.filter((e) => e.evidence_type === 'page_snapshot' && e.pinned_for_visit).length
  const lostSilently = evidence.filter((e) => e.storage_path === null).length

  let integratedToVisit = 0
  if (siteReportId) {
    const { count, error: vcErr } = await supabase
      .from('visit_capture')
      .select('id', { count: 'exact', head: true })
      .eq('report_id', siteReportId)
      .eq('source', 'historical_import')
      .eq('kind', 'photo')
    if (vcErr) throw new Error(vcErr.message)
    integratedToVisit = count ?? 0
  }

  let illustratesConfirmed = 0
  let candidatesRemaining = 0
  let dismissed = 0
  const evidenceIds = evidence.map((e) => e.id)
  if (evidenceIds.length > 0) {
    const { data: relRows, error: relErr } = await supabase
      .from('document_proposal_evidence')
      .select('relation_type')
      .in('evidence_id', evidenceIds)
      .in('relation_type', ['illustrates', 'candidate', 'dismissed'])
    if (relErr) throw new Error(relErr.message)
    const rels = (relRows ?? []) as Array<{ relation_type: DocumentEvidenceRelationType }>
    illustratesConfirmed = rels.filter((r) => r.relation_type === 'illustrates').length
    candidatesRemaining = rels.filter((r) => r.relation_type === 'candidate').length
    dismissed = rels.filter((r) => r.relation_type === 'dismissed').length
  }

  return {
    detected,
    nativeRetained,
    snapshotFallbackRetained,
    integratedToVisit,
    illustratesConfirmed,
    candidatesRemaining,
    dismissed,
    lostSilently,
  }
}
