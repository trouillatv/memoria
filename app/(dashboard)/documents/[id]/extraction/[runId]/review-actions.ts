'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { reviewProposal, linkProposalEvidence } from '@/lib/db/document-extractions'
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
