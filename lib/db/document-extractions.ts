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
      status: 'pending' as DocumentExtractionRunStatus,
      created_by: input.created_by ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function updateExtractionRunStatus(
  runId: string,
  status: DocumentExtractionRunStatus,
  extra?: { error_message?: string; completed_at?: string; started_at?: string },
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('document_extraction_run')
    .update({
      status,
      ...(extra?.error_message !== undefined ? { error_message: extra.error_message } : {}),
      ...(extra?.completed_at !== undefined ? { completed_at: extra.completed_at } : {}),
      ...(extra?.started_at !== undefined ? { started_at: extra.started_at } : {}),
    })
    .eq('id', runId)
  if (error) throw error
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
    review_status: 'pending' as DocumentProposalReviewStatus,
  }))
  const { data, error } = await supabase
    .from('document_extraction_proposal')
    .insert(rows)
    .select('id')
  if (error) throw error
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
): Promise<string[]> {
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
    .select('id')
  if (error) throw error
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

// ── Relations M-M (idempotentes) ─────────────────────────────────────────────

export async function linkProposalEvidence(
  proposalId: string,
  evidenceId: string,
  relationType: DocumentEvidenceRelationType,
  confidence?: number | null,
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
      { onConflict: 'proposal_id,evidence_id,relation_type', ignoreDuplicates: true },
    )
  if (error) throw error
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
  if (pErr) throw pErr

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
  if (rErr) throw rErr
  if (mErr) throw mErr

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
  if (fetchErr) throw fetchErr
  const status = (current as { review_status: DocumentProposalReviewStatus }).review_status
  if (status === 'materialized') {
    throw new Error(`Proposition ${proposalId} déjà matérialisée — révision impossible.`)
  }

  const now = new Date().toISOString()
  let patch: Partial<DbDocumentExtractionProposal>

  if (review.action === 'reject') {
    patch = { review_status: 'rejected', reviewed_at: now, reviewed_by: reviewedBy ?? null }
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
  if (error) throw error
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
  if (pErr) throw pErr
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
  if (error) throw error

  // Mettre à jour le statut de la proposition
  await supabase
    .from('document_extraction_proposal')
    .update({ review_status: 'materialized' })
    .eq('id', input.proposal_id)
}
