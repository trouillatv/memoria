'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { reviewProposal, linkProposalEvidence } from '@/lib/db/document-extractions'
import { materializeHistoricalVisit } from '@/lib/db/historical-visit-materialization'
import type { DocumentProposalFamily, DocumentEvidenceRelationType } from '@/types/db'

type ActionResult = { ok: boolean; error?: string }

// ─── Vérification d'accès commune ────────────────────────────────────────────

export async function verifyReviewAccess(
  documentId: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié' }

  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { ok: false, error: 'Permissions insuffisantes' }

  if (role !== 'admin') {
    const admin = createAdminClient()
    const { data: doc } = await admin
      .from('documents')
      .select('organization_id')
      .eq('id', documentId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!doc) return { ok: false, error: 'Document introuvable' }
    const orgId = (doc as { organization_id: string }).organization_id
    const orgIds = await getOrgIdsOfUser()
    if (!orgIds.includes(orgId)) return { ok: false, error: 'Accès refusé' }
  }

  return { ok: true, userId: user.id }
}

export async function verifyProposalOwnership(
  proposalId: string,
  documentId: string,
): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('document_extraction_proposal')
    .select('document_id')
    .eq('id', proposalId)
    .maybeSingle()
  return !!data && (data as { document_id: string }).document_id === documentId
}

// ─── Actions de revue ─────────────────────────────────────────────────────────

export async function acceptProposalAction(fd: FormData): Promise<ActionResult> {
  const proposalId = fd.get('proposal_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  if (!proposalId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  if (!(await verifyProposalOwnership(proposalId, documentId))) {
    return { ok: false, error: 'Proposition introuvable' }
  }

  await reviewProposal(proposalId, { action: 'accept' }, access.userId)
  return { ok: true }
}

export async function editProposalAction(fd: FormData): Promise<ActionResult> {
  const proposalId = fd.get('proposal_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  const label = fd.get('label')?.toString()
  const description = fd.get('description')?.toString() ?? null
  const family = fd.get('family')?.toString() as DocumentProposalFamily | undefined

  if (!proposalId || !documentId || !label?.trim()) return { ok: false, error: 'Paramètres invalides' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  if (!(await verifyProposalOwnership(proposalId, documentId))) {
    return { ok: false, error: 'Proposition introuvable' }
  }

  await reviewProposal(
    proposalId,
    { action: 'edit', label: label.trim(), description: description || null, family },
    access.userId,
  )
  return { ok: true }
}

export async function rejectProposalAction(fd: FormData): Promise<ActionResult> {
  const proposalId = fd.get('proposal_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  if (!proposalId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  if (!(await verifyProposalOwnership(proposalId, documentId))) {
    return { ok: false, error: 'Proposition introuvable' }
  }

  await reviewProposal(proposalId, { action: 'reject' }, access.userId)
  return { ok: true }
}

export async function resetProposalAction(fd: FormData): Promise<ActionResult> {
  const proposalId = fd.get('proposal_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  if (!proposalId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  if (!(await verifyProposalOwnership(proposalId, documentId))) {
    return { ok: false, error: 'Proposition introuvable' }
  }

  await reviewProposal(proposalId, { action: 'reset' }, access.userId)
  return { ok: true }
}

export async function relinkEvidenceAction(fd: FormData): Promise<ActionResult> {
  const proposalId = fd.get('proposal_id')?.toString()
  const evidenceId = fd.get('evidence_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  const relationType = (fd.get('relation_type')?.toString() ?? 'supports') as DocumentEvidenceRelationType

  if (!proposalId || !evidenceId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  if (!(await verifyProposalOwnership(proposalId, documentId))) {
    return { ok: false, error: 'Proposition introuvable' }
  }

  await linkProposalEvidence(proposalId, evidenceId, relationType)
  return { ok: true }
}

// ─── Tout confirmer ───────────────────────────────────────────────────────────

export async function acceptAllPendingAction(fd: FormData): Promise<{
  ok: boolean; count?: number; error?: string
}> {
  const runId = fd.get('run_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  if (!runId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return { ok: false, error: access.error }

  const admin = createAdminClient()
  const { data: pending } = await admin
    .from('document_extraction_proposal')
    .select('id')
    .eq('extraction_run_id', runId)
    .eq('review_status', 'pending')

  if (!pending?.length) return { ok: true, count: 0 }

  const { error } = await admin
    .from('document_extraction_proposal')
    .update({ review_status: 'accepted', reviewed_by: access.userId, reviewed_at: new Date().toISOString() })
    .eq('extraction_run_id', runId)
    .eq('review_status', 'pending')

  if (error) return { ok: false, error: error.message }
  return { ok: true, count: pending.length }
}

// ─── Matérialisation — création de la visite historique ──────────────────────

export async function createHistoricalVisitAction(fd: FormData): Promise<{
  ok: boolean
  siteReportId?: string
  siteId?: string
  error?: string
}> {
  const runId = fd.get('run_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  const visitTitle = fd.get('visit_title')?.toString()?.trim() || null

  if (!runId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return { ok: false, error: access.error }

  const admin = createAdminClient()

  const { data: run } = await admin
    .from('document_extraction_run')
    .select('target_site_id, document_id')
    .eq('id', runId)
    .eq('document_id', documentId)
    .maybeSingle()
  if (!run) return { ok: false, error: 'Run introuvable' }

  const siteId = (run as { target_site_id: string | null }).target_site_id
  if (!siteId) return { ok: false, error: 'Aucun chantier associé à ce run — rattachez le document à un chantier.' }

  const { data: doc } = await admin
    .from('documents')
    .select('effective_date')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!doc) return { ok: false, error: 'Document introuvable' }

  const visitDate = (doc as { effective_date: string | null }).effective_date
  if (!visitDate) {
    return { ok: false, error: "La date du PV est requise. Modifiez le document pour renseigner la date d'effet." }
  }

  let siteReportId: string
  try {
    siteReportId = await materializeHistoricalVisit({
      runId,
      userId: access.userId,
      siteId,
      visitDate,
      visitTitle,
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur lors de la matérialisation' }
  }

  // ── Pipeline post-RPC : knowledge_fact → captured_knowledge ──────────────
  // Le RPC SQL exclut délibérément ces familles (trop riches pour du PL/pgSQL pur).
  // On les traite ici, en TypeScript, après que la visite est créée.
  try {
    const { data: site } = await admin
      .from('sites')
      .select('organization_id')
      .eq('id', siteId)
      .maybeSingle()
    const orgId = (site as { organization_id: string } | null)?.organization_id

    if (orgId) {
      const { data: kfProps } = await admin
        .from('document_extraction_proposal')
        .select('id, label, reviewed_label, description, reviewed_description')
        .eq('extraction_run_id', runId)
        .in('review_status', ['accepted', 'edited'])
        .eq('proposal_family', 'knowledge_fact')

      for (const prop of kfProps ?? []) {
        const p = prop as {
          id: string; label: string; reviewed_label: string | null
          description: string | null; reviewed_description: string | null
        }
        const title = p.reviewed_label ?? p.label
        const body = p.reviewed_description ?? p.description ?? null

        const { data: ck } = await admin
          .from('captured_knowledge')
          .insert({
            organization_id: orgId,
            site_id: siteId,
            source_type: 'visit',
            source_id: siteReportId,
            kind: 'avancement',
            title,
            body,
            created_by: access.userId,
          })
          .select('id')
          .single()

        if (ck) {
          const ckId = (ck as { id: string }).id
          await Promise.all([
            admin
              .from('document_extraction_proposal')
              .update({ review_status: 'materialized', reviewed_at: new Date().toISOString() })
              .eq('id', p.id),
            admin
              .from('document_proposal_materialization')
              .insert({
                organization_id: orgId,
                proposal_id: p.id,
                target_entity_type: 'captured_knowledge',
                target_entity_id: ckId,
                status: 'done',
                created_by: access.userId,
              }),
          ])
        }
      }

      // Après pipeline TypeScript, statut du run = fully materialized
      await admin
        .from('document_extraction_run')
        .update({ status: 'materialized' })
        .eq('id', runId)
        .eq('status', 'partially_materialized')
    }
  } catch {
    // Non bloquant : la visite est créée, le pipeline knowledge est best-effort
  }

  return { ok: true, siteReportId, siteId }
}
