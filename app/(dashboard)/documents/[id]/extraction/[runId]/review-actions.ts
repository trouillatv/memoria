'use server'

import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { reviewProposal, linkProposalEvidence, acceptAllPendingForRun } from '@/lib/db/document-extractions'
import { runHistoricalImportPostProcessing } from '@/lib/subjects/historical-import-post-processing'
import { materializeHistoricalRun } from '@/lib/documents/materialize-historical-run'
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

/**
 * P0-B : applique la date détectée dans le document comme date de référence
 * (documents.effective_date), après confirmation humaine à la revue. Jamais de
 * substitution silencieuse — cette action n'est déclenchée que par un clic explicite
 * « Utiliser la date détectée ». La matérialisation (createHistoricalVisitAction) lit
 * ensuite cette date ; les occurrences en héritent. Ne ré-extrait rien.
 */
export async function setImportDocumentDateAction(fd: FormData): Promise<ActionResult> {
  const documentId = fd.get('document_id')?.toString()
  const iso = fd.get('effective_date')?.toString()
  if (!documentId || !iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { ok: false, error: 'Paramètres invalides' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  const admin = createAdminClient()
  const { error } = await admin
    .from('documents')
    .update({ effective_date: iso, updated_at: new Date().toISOString() })
    .eq('id', documentId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/documents/${documentId}`)
  return { ok: true }
}

export async function acceptProposalAction(fd: FormData): Promise<ActionResult> {
  const proposalId = fd.get('proposal_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  const subjectId = fd.get('subject_id')?.toString() ?? null
  if (!proposalId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  if (!(await verifyProposalOwnership(proposalId, documentId))) {
    return { ok: false, error: 'Proposition introuvable' }
  }

  await reviewProposal(proposalId, { action: 'accept' }, access.userId)

  // Choix de sujet — stocké dans source_payload pour lecture à la matérialisation
  if (subjectId) {
    const admin = createAdminClient()
    const { data: existing } = await admin
      .from('document_extraction_proposal')
      .select('source_payload')
      .eq('id', proposalId)
      .maybeSingle()
    const currentPayload = (existing as { source_payload: Record<string, unknown> | null } | null)?.source_payload ?? {}
    await admin
      .from('document_extraction_proposal')
      .update({ source_payload: { ...currentPayload, __subjectId: subjectId } })
      .eq('id', proposalId)
  }

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

const VALID_ATTENDANCE_STATUSES = new Set([
  'présent', 'absent excusé', 'absent non excusé', 'invité', 'diffusion uniquement', 'non déterminé',
])

export async function updatePersonAttendanceAction(fd: FormData): Promise<ActionResult> {
  const proposalId = fd.get('proposal_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  const status = fd.get('attendance_status')?.toString()

  if (!proposalId || !documentId || !status) return { ok: false, error: 'Paramètres manquants' }
  if (!VALID_ATTENDANCE_STATUSES.has(status)) return { ok: false, error: 'Statut invalide' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  if (!(await verifyProposalOwnership(proposalId, documentId))) {
    return { ok: false, error: 'Proposition introuvable' }
  }

  const admin = createAdminClient()
  const { data: proposal } = await admin
    .from('document_extraction_proposal')
    .select('source_payload')
    .eq('id', proposalId)
    .single()

  if (!proposal) return { ok: false, error: 'Proposition introuvable' }

  const newPayload = {
    ...((proposal.source_payload as Record<string, unknown>) ?? {}),
    statusAtDocumentDate: status,
  }

  const { error } = await admin
    .from('document_extraction_proposal')
    .update({ source_payload: newPayload, review_status: 'edited' })
    .eq('id', proposalId)

  if (error) return { ok: false, error: error.message }
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

  return acceptAllPendingForRun({ runId, userId: access.userId })
}

// ─── Épingler un snapshot pour la fiche visite ────────────────────────────────

export async function toggleEvidencePinAction(fd: FormData): Promise<ActionResult> {
  const evidenceId = fd.get('evidence_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  const pinned = fd.get('pinned')?.toString() === 'true'

  if (!evidenceId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  const admin = createAdminClient()
  const { data: ev } = await admin
    .from('document_extraction_evidence')
    .select('id')
    .eq('id', evidenceId)
    .eq('document_id', documentId)
    .maybeSingle()
  if (!ev) return { ok: false, error: 'Preuve introuvable' }

  const { error } = await admin
    .from('document_extraction_evidence')
    .update({ pinned_for_visit: pinned })
    .eq('id', evidenceId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ─── Épingler / désépingler toutes les pages photo d'un run ─────────────────

export async function pinAllSnapshotsAction(fd: FormData): Promise<ActionResult> {
  const runId = fd.get('run_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  const pinned = fd.get('pinned')?.toString() === 'true'
  if (!runId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  const admin = createAdminClient()

  if (!pinned) {
    const { error } = await admin
      .from('document_extraction_evidence')
      .update({ pinned_for_visit: false })
      .eq('extraction_run_id', runId)
      .in('evidence_type', ['page_snapshot', 'image'])
    return error ? { ok: false, error: error.message } : { ok: true }
  }

  // Règle de priorité : si une page a des images natives, le snapshot de cette page
  // ne doit pas être épinglé — il ne sert que de fallback pour les pages sans images.
  const { data: allVisual } = await admin
    .from('document_extraction_evidence')
    .select('id, source_page, evidence_type')
    .eq('extraction_run_id', runId)
    .in('evidence_type', ['page_snapshot', 'image'])

  if (!allVisual?.length) return { ok: true }

  const pagesWithImages = new Set(
    allVisual.filter((e) => e.evidence_type === 'image').map((e) => e.source_page),
  )
  const toPin   = allVisual.filter((e) => e.evidence_type === 'image' || !pagesWithImages.has(e.source_page)).map((e) => e.id)
  const toUnpin = allVisual.filter((e) => e.evidence_type === 'page_snapshot' && pagesWithImages.has(e.source_page)).map((e) => e.id)

  if (toPin.length > 0) {
    const { error } = await admin.from('document_extraction_evidence').update({ pinned_for_visit: true  }).in('id', toPin)
    if (error) return { ok: false, error: error.message }
  }
  if (toUnpin.length > 0) {
    const { error } = await admin.from('document_extraction_evidence').update({ pinned_for_visit: false }).in('id', toUnpin)
    if (error) return { ok: false, error: error.message }
  }

  // Re-lier la visite existante au run courant pour que revue et fiche partagent
  // le même extraction_run_id (une ré-extraction crée un nouveau run mais la visite
  // stocke toujours l'ancien).
  const { data: run } = await admin
    .from('document_extraction_run')
    .select('target_site_id')
    .eq('id', runId)
    .maybeSingle()
  if (run?.target_site_id) {
    const { data: allDocRuns } = await admin
      .from('document_extraction_run')
      .select('id')
      .eq('document_id', documentId)
    const docRunIds = (allDocRuns ?? []).map((r: { id: string }) => r.id)
    if (docRunIds.length > 0) {
      await admin
        .from('site_reports')
        .update({ extraction_run_id: runId })
        .eq('site_id', run.target_site_id)
        .in('extraction_run_id', docRunIds)
    }
  }

  return { ok: true }
}

// ─── Association photo ↔ proposition ─────────────────────────────────────────

export async function confirmPhotoAssociationAction(fd: FormData): Promise<ActionResult> {
  const evidenceId = fd.get('evidence_id')?.toString()
  const proposalId = fd.get('proposal_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  if (!evidenceId || !proposalId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  const admin = createAdminClient()
  const { data: ev } = await admin
    .from('document_extraction_evidence')
    .select('id')
    .eq('id', evidenceId)
    .eq('document_id', documentId)
    .maybeSingle()
  if (!ev) return { ok: false, error: 'Preuve introuvable' }

  // Supprimer le lien candidat, créer le lien illustrates (idempotent)
  await admin
    .from('document_proposal_evidence')
    .delete()
    .eq('evidence_id', evidenceId)
    .eq('proposal_id', proposalId)
    .eq('relation_type', 'candidate')

  await linkProposalEvidence(proposalId, evidenceId, 'illustrates')
  return { ok: true }
}

export async function dismissPhotoAssociationAction(fd: FormData): Promise<ActionResult> {
  const evidenceId = fd.get('evidence_id')?.toString()
  const proposalId = fd.get('proposal_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  if (!evidenceId || !proposalId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  const admin = createAdminClient()
  const { data: ev } = await admin
    .from('document_extraction_evidence')
    .select('id')
    .eq('id', evidenceId)
    .eq('document_id', documentId)
    .maybeSingle()
  if (!ev) return { ok: false, error: 'Preuve introuvable' }

  // On supprime le lien 'candidate' et on insère 'dismissed' pour mémoriser la décision.
  // Lors d'une future régénération, listCandidateLinksForRun filtrera les paires dismissées.
  await admin
    .from('document_proposal_evidence')
    .delete()
    .eq('evidence_id', evidenceId)
    .eq('proposal_id', proposalId)
    .eq('relation_type', 'candidate')

  await linkProposalEvidence(proposalId, evidenceId, 'dismissed')
  return { ok: true }
}

export async function revertIllustratesAction(fd: FormData): Promise<ActionResult> {
  const evidenceId = fd.get('evidence_id')?.toString()
  const proposalId = fd.get('proposal_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  if (!evidenceId || !proposalId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return access

  const admin = createAdminClient()
  const { data: ev } = await admin
    .from('document_extraction_evidence')
    .select('id')
    .eq('id', evidenceId)
    .eq('document_id', documentId)
    .maybeSingle()
  if (!ev) return { ok: false, error: 'Preuve introuvable' }

  await admin
    .from('document_proposal_evidence')
    .delete()
    .eq('evidence_id', evidenceId)
    .eq('proposal_id', proposalId)
    .eq('relation_type', 'illustrates')

  await linkProposalEvidence(proposalId, evidenceId, 'candidate')
  return { ok: true }
}

// ─── Matérialisation — création de la visite historique ──────────────────────

export async function createHistoricalVisitAction(fd: FormData): Promise<{
  ok: boolean
  siteReportId?: string
  siteId?: string
  message?: string
  error?: string
}> {
  const runId = fd.get('run_id')?.toString()
  const documentId = fd.get('document_id')?.toString()
  const visitTitle = fd.get('visit_title')?.toString()?.trim() || null
  const nonVisitAcknowledged = fd.get('non_visit_acknowledged')?.toString() === 'true'

  if (!runId || !documentId) return { ok: false, error: 'Paramètres manquants' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return { ok: false, error: access.error }

  const result = await materializeHistoricalRun({
    runId,
    documentId,
    userId: access.userId,
    visitTitle,
    nonVisitAcknowledged,
  })
  if (!result.ok || !result.siteReportId || !result.siteId || !result.visitDate) {
    return { ok: false, error: result.error }
  }

  const { siteReportId, siteId, visitDate } = result

  // Le succès utilisateur s'arrête ici : la visite, les captures et les objets
  // métier sont persistés. Le reste est rejouable et ne retient plus la réponse.
  after(() => runHistoricalImportPostProcessing({ runId, siteId, siteReportId, visitDate }))

  return {
    ok: true,
    siteReportId,
    siteId,
    message: result.message,
  }
}

// ─── Construction de la mémoire — réessai manuel ──────────────────────────────
// Widget "MemorIA construit la mémoire du chantier" (P1-A, lot UI final) :
// permet de reprendre l'orchestrateur complet après une interruption. Le verrou
// à bail et chaque étape aval rendent ce rejeu idempotent.

export async function retryMemoryBuildAction(fd: FormData): Promise<ActionResult> {
  const siteReportId = fd.get('site_report_id')?.toString()
  if (!siteReportId) return { ok: false, error: 'Paramètres manquants' }

  const admin = createAdminClient()

  const { data: report } = await admin
    .from('site_reports')
    .select('id, site_id, extraction_run_id')
    .eq('id', siteReportId)
    .maybeSingle()
  if (!report) return { ok: false, error: 'Visite introuvable' }

  const siteId = (report as { site_id: string | null }).site_id
  const runId = (report as { extraction_run_id: string | null }).extraction_run_id
  if (!siteId || !runId) return { ok: false, error: "Cette visite n'est pas issue d'un import." }

  const { data: run } = await admin
    .from('document_extraction_run')
    .select('document_id')
    .eq('id', runId)
    .maybeSingle()
  const documentId = (run as { document_id: string | null } | null)?.document_id
  if (!documentId) return { ok: false, error: 'Document source introuvable' }

  const access = await verifyReviewAccess(documentId)
  if (!access.ok) return { ok: false, error: access.error }

  const { data: doc } = await admin
    .from('documents')
    .select('effective_date')
    .eq('id', documentId)
    .maybeSingle()
  const visitDate = (doc as { effective_date: string | null } | null)?.effective_date
  if (!visitDate) return { ok: false, error: "Date du PV introuvable" }

  // Le même point d'entrée sert au chemin normal, au retry manuel et au sweep.
  after(() => runHistoricalImportPostProcessing({ runId, siteId, siteReportId, visitDate }))

  revalidatePath(`/sites/${siteId}/visites/${siteReportId}`)
  return { ok: true }
}
