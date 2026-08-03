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

  // ── Pipeline post-RPC : knowledge_fact → site_knowledge_entries ──────────
  // Le RPC SQL exclut délibérément ces familles (trop riches pour du PL/pgSQL pur).
  // On les traite ici, en TypeScript, après que la visite est créée.
  // Lot B : destination = site_knowledge_entries (read model), pas captured_knowledge.
  // La thematic_category est propagée depuis la colonne extraite par le LLM.
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
        .select('id, label, reviewed_label, description, reviewed_description, thematic_category')
        .eq('extraction_run_id', runId)
        .in('review_status', ['accepted', 'edited'])
        .eq('proposal_family', 'knowledge_fact')

      for (const prop of kfProps ?? []) {
        const p = prop as {
          id: string; label: string; reviewed_label: string | null
          description: string | null; reviewed_description: string | null
          thematic_category: string | null
        }
        const title = p.reviewed_label ?? p.label
        const body = p.reviewed_description ?? p.description ?? null

        const { data: ske } = await admin
          .from('site_knowledge_entries')
          .insert({
            organization_id: orgId,
            site_id: siteId,
            source_report_id: siteReportId,
            kind: 'current_information',
            title,
            body,
            thematic_category: p.thematic_category ?? null,
            confirmed_by: access.userId,
            confirmed_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (ske) {
          const skeId = (ske as { id: string }).id
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
                target_entity_type: 'site_knowledge_entries',
                target_entity_id: skeId,
                status: 'done',
                created_by: access.userId,
              }),
          ])
        }
      }

      // ── Pipeline : company + person → companies / company_contacts / site_intervenants ──
      const { data: companyPropsRaw } = await admin
        .from('document_extraction_proposal')
        .select('id, label, reviewed_label, source_payload, stable_key')
        .eq('extraction_run_id', runId)
        .in('review_status', ['accepted', 'edited'])
        .eq('proposal_family', 'company')

      const { data: personPropsRaw } = await admin
        .from('document_extraction_proposal')
        .select('id, label, reviewed_label, description, source_payload, stable_key')
        .eq('extraction_run_id', runId)
        .in('review_status', ['accepted', 'edited'])
        .eq('proposal_family', 'person')

      type SPCompany = { companyRole?: string; statusAtDocumentDate?: string }
      type SPPerson = { statusAtDocumentDate?: string; linkedCompanyName?: string | null; emailAddress?: string | null; phoneNumber?: string | null }

      const companyMap = new Map<string, { companyId: string; siteIntervenantId: string }>()
      const stableKeyToCompanyId = new Map<string, string>()
      const stableKeyToContactId = new Map<string, string>()

      for (const rawProp of companyPropsRaw ?? []) {
        const prop = rawProp as { id: string; label: string; reviewed_label: string | null; source_payload: SPCompany | null; stable_key: string | null }
        const companyName = prop.reviewed_label ?? prop.label
        const role = prop.source_payload?.companyRole ?? prop.source_payload?.statusAtDocumentDate ?? 'partenaire'

        const { data: existingCo } = await admin
          .from('companies')
          .select('id')
          .eq('organization_id', orgId)
          .ilike('name', companyName)
          .is('deleted_at', null)
          .maybeSingle()

        let companyId: string
        if (existingCo) {
          companyId = (existingCo as { id: string }).id
        } else {
          const { data: newCo } = await admin
            .from('companies')
            .insert({ organization_id: orgId, name: companyName })
            .select('id')
            .single()
          if (!newCo) continue
          companyId = (newCo as { id: string }).id
        }

        const { data: existingSi } = await admin
          .from('site_intervenants')
          .select('id')
          .eq('site_id', siteId)
          .eq('role', role)
          .eq('company_id', companyId)
          .is('effective_to', null)
          .maybeSingle()

        let siteIntervenantId: string
        if (existingSi) {
          siteIntervenantId = (existingSi as { id: string }).id
        } else {
          const { data: newSi } = await admin
            .from('site_intervenants')
            .insert({ site_id: siteId, role, company_id: companyId, effective_from: visitDate.split('T')[0], source_report_id: siteReportId })
            .select('id')
            .single()
          if (!newSi) continue
          siteIntervenantId = (newSi as { id: string }).id
        }

        companyMap.set(companyName.toLowerCase(), { companyId, siteIntervenantId })
        if (prop.stable_key) stableKeyToCompanyId.set(prop.stable_key, companyId)
        await Promise.all([
          admin.from('document_extraction_proposal').update({ review_status: 'materialized', reviewed_at: new Date().toISOString() }).eq('id', prop.id),
          admin.from('document_proposal_materialization').upsert({ organization_id: orgId, proposal_id: prop.id, target_entity_type: 'site_intervenants', target_entity_id: siteIntervenantId, status: 'done', created_by: access.userId }, { onConflict: 'proposal_id, target_entity_type, target_entity_id', ignoreDuplicates: true }),
        ])
      }

      for (const rawProp of personPropsRaw ?? []) {
        const prop = rawProp as { id: string; label: string; reviewed_label: string | null; description: string | null; source_payload: SPPerson | null; stable_key: string | null }
        const personName = prop.reviewed_label ?? prop.label
        const sp = prop.source_payload
        const linkedCompanyName = sp?.linkedCompanyName ?? null
        const email = sp?.emailAddress ?? null
        const phone = sp?.phoneNumber ?? null
        const personFunction = prop.description?.split(' — ')[0]?.trim() ?? null

        if (!linkedCompanyName) continue
        const entry = companyMap.get(linkedCompanyName.toLowerCase())
        if (!entry) continue
        const { companyId, siteIntervenantId } = entry

        const { data: existingContact } = await admin
          .from('company_contacts')
          .select('id')
          .eq('company_id', companyId)
          .ilike('full_name', personName)
          .is('deleted_at', null)
          .maybeSingle()

        let contactId: string
        if (existingContact) {
          contactId = (existingContact as { id: string }).id
          if (email || phone) {
            await admin.from('company_contacts').update({ ...(email ? { email } : {}), ...(phone ? { phone } : {}) }).eq('id', contactId)
          }
        } else {
          const { data: newContact } = await admin
            .from('company_contacts')
            .insert({ company_id: companyId, full_name: personName, function: personFunction, email, phone })
            .select('id')
            .single()
          if (!newContact) continue
          contactId = (newContact as { id: string }).id
        }

        await admin.from('site_intervenants').update({ main_contact_id: contactId }).eq('id', siteIntervenantId).is('main_contact_id', null)
        if (prop.stable_key) stableKeyToContactId.set(prop.stable_key, contactId)
        await Promise.all([
          admin.from('document_extraction_proposal').update({ review_status: 'materialized', reviewed_at: new Date().toISOString() }).eq('id', prop.id),
          admin.from('document_proposal_materialization').upsert({ organization_id: orgId, proposal_id: prop.id, target_entity_type: 'company_contacts', target_entity_id: contactId, status: 'done', created_by: access.userId }, { onConflict: 'proposal_id, target_entity_type, target_entity_id', ignoreDuplicates: true }),
        ])
      }

      // ── Résolution linkedActorTemporaryKey → site_actions.assigned_* ─────────
      // Aucun fallback par nom ou page : résolution exclusivement par stable_key.
      if (stableKeyToCompanyId.size > 0 || stableKeyToContactId.size > 0) {
        const { resolveLinkedActors } = await import('@/lib/documents/linked-actor-resolution')

        const { data: actionPropsRaw } = await admin
          .from('document_extraction_proposal')
          .select('id, source_payload')
          .eq('extraction_run_id', runId)
          .in('review_status', ['accepted', 'edited', 'materialized'])
          .eq('proposal_family', 'action')

        if (actionPropsRaw && actionPropsRaw.length > 0) {
          const actionProposalIds = (actionPropsRaw as Array<{ id: string }>).map((p) => p.id)

          const { data: matRows } = await admin
            .from('document_proposal_materialization')
            .select('proposal_id, target_entity_id')
            .in('proposal_id', actionProposalIds)
            .eq('target_entity_type', 'site_action')

          const materializedActions = new Map<string, string>(
            (matRows ?? []).map((r) => {
              const row = r as { proposal_id: string; target_entity_id: string }
              return [row.proposal_id, row.target_entity_id]
            }),
          )

          const assignments = resolveLinkedActors(
            actionPropsRaw as Array<{ id: string; source_payload: Record<string, unknown> | null }>,
            materializedActions,
            stableKeyToCompanyId,
            stableKeyToContactId,
          )

          await Promise.all(
            assignments.map((a) =>
              admin.from('site_actions').update(
                a.kind === 'company'
                  ? { assigned_company_id: a.actorId }
                  : { assigned_contact_id: a.actorId },
              ).eq('id', a.siteActionId),
            ),
          )
        }
      }

      // ── Résolution linkedActorTemporaryKey → site_decisions.decisionnaire_* ────
      // Même règle que pour les actions : stable_key uniquement, aucun fallback.
      if (stableKeyToCompanyId.size > 0 || stableKeyToContactId.size > 0) {
        const { resolveLinkedActorsForDecisions } = await import('@/lib/documents/linked-actor-resolution')

        const { data: decisionPropsRaw } = await admin
          .from('document_extraction_proposal')
          .select('id, source_payload')
          .eq('extraction_run_id', runId)
          .in('review_status', ['accepted', 'edited', 'materialized'])
          .eq('proposal_family', 'decision')

        if (decisionPropsRaw && decisionPropsRaw.length > 0) {
          const decisionProposalIds = (decisionPropsRaw as Array<{ id: string }>).map((p) => p.id)

          const { data: decMatRows } = await admin
            .from('document_proposal_materialization')
            .select('proposal_id, target_entity_id')
            .in('proposal_id', decisionProposalIds)
            .eq('target_entity_type', 'site_decision')

          const materializedDecisions = new Map<string, string>(
            (decMatRows ?? []).map((r) => {
              const row = r as { proposal_id: string; target_entity_id: string }
              return [row.proposal_id, row.target_entity_id]
            }),
          )

          const decAssignments = resolveLinkedActorsForDecisions(
            decisionPropsRaw as Array<{ id: string; source_payload: Record<string, unknown> | null }>,
            materializedDecisions,
            stableKeyToCompanyId,
            stableKeyToContactId,
          )

          await Promise.all(
            decAssignments.map((a) =>
              admin.from('site_decisions').update(
                a.kind === 'company'
                  ? { decisionnaire_company_id: a.actorId }
                  : { decisionnaire_contact_id: a.actorId },
              ).eq('id', a.siteDecisionId),
            ),
          )
        }
      }

      // ── Résolution linkedActorTemporaryKey → site_reserve.responsible_company_id ──
      // Même règle : stable_key uniquement, company seulement (pas de contact pour les réserves).
      if (stableKeyToCompanyId.size > 0) {
        const { resolveLinkedActorsForReserves } = await import('@/lib/documents/linked-actor-resolution')

        const { data: reservePropsRaw } = await admin
          .from('document_extraction_proposal')
          .select('id, source_payload')
          .eq('extraction_run_id', runId)
          .in('review_status', ['accepted', 'edited', 'materialized'])
          .eq('proposal_family', 'reservation')

        if (reservePropsRaw && reservePropsRaw.length > 0) {
          const reserveProposalIds = (reservePropsRaw as Array<{ id: string }>).map((p) => p.id)

          const { data: resMatRows } = await admin
            .from('document_proposal_materialization')
            .select('proposal_id, target_entity_id')
            .in('proposal_id', reserveProposalIds)
            .eq('target_entity_type', 'site_reserve')

          const materializedReserves = new Map<string, string>(
            (resMatRows ?? []).map((r) => {
              const row = r as { proposal_id: string; target_entity_id: string }
              return [row.proposal_id, row.target_entity_id]
            }),
          )

          const resAssignments = resolveLinkedActorsForReserves(
            reservePropsRaw as Array<{ id: string; source_payload: Record<string, unknown> | null }>,
            materializedReserves,
            stableKeyToCompanyId,
          )

          await Promise.all(
            resAssignments.map((a) =>
              admin.from('site_reserve').update({ responsible_company_id: a.companyId }).eq('id', a.siteReserveId),
            ),
          )
        }
      }

      // ── Résolution linkedActorTemporaryKey → site_deadlines.assigned_* ──────
      // Même règle : stable_key uniquement, company + contact (comme les actions).
      if (stableKeyToCompanyId.size > 0 || stableKeyToContactId.size > 0) {
        const { resolveLinkedActorsForDeadlines } = await import('@/lib/documents/linked-actor-resolution')

        const { data: deadlinePropsRaw } = await admin
          .from('document_extraction_proposal')
          .select('id, source_payload')
          .eq('extraction_run_id', runId)
          .in('review_status', ['accepted', 'edited', 'materialized'])
          .eq('proposal_family', 'deadline')

        if (deadlinePropsRaw && deadlinePropsRaw.length > 0) {
          const deadlineProposalIds = (deadlinePropsRaw as Array<{ id: string }>).map((p) => p.id)

          const { data: dlMatRows } = await admin
            .from('document_proposal_materialization')
            .select('proposal_id, target_entity_id')
            .in('proposal_id', deadlineProposalIds)
            .eq('target_entity_type', 'site_deadline')

          const materializedDeadlines = new Map<string, string>(
            (dlMatRows ?? []).map((r) => {
              const row = r as { proposal_id: string; target_entity_id: string }
              return [row.proposal_id, row.target_entity_id]
            }),
          )

          const dlAssignments = resolveLinkedActorsForDeadlines(
            deadlinePropsRaw as Array<{ id: string; source_payload: Record<string, unknown> | null }>,
            materializedDeadlines,
            stableKeyToCompanyId,
            stableKeyToContactId,
          )

          await Promise.all(
            dlAssignments.map((a) =>
              admin.from('site_deadlines').update(
                a.kind === 'company'
                  ? { assigned_company_id: a.actorId }
                  : { assigned_contact_id: a.actorId },
              ).eq('id', a.siteDeadlineId),
            ),
          )
        }
      }

      // ── Rattachement sujet choisi → site_deadlines.subject_id ───────────────
      {
        const { data: dlSubjectProps } = await admin
          .from('document_extraction_proposal')
          .select('id, source_payload')
          .eq('extraction_run_id', runId)
          .in('review_status', ['accepted', 'edited', 'materialized'])
          .eq('proposal_family', 'deadline')

        const dlPropsWithSubject = (dlSubjectProps ?? []).filter((p) => {
          const sp = p as { id: string; source_payload: Record<string, unknown> | null }
          return typeof sp.source_payload?.__subjectId === 'string'
        }) as Array<{ id: string; source_payload: Record<string, unknown> }>

        if (dlPropsWithSubject.length > 0) {
          const { attachToSubject } = await import('@/lib/db/subjects')

          const propIds = dlPropsWithSubject.map((p) => p.id)
          const { data: matRowsDl } = await admin
            .from('document_proposal_materialization')
            .select('proposal_id, target_entity_id')
            .in('proposal_id', propIds)
            .eq('target_entity_type', 'site_deadline')

          const propToDeadline = new Map<string, string>(
            (matRowsDl ?? []).map((r) => {
              const row = r as { proposal_id: string; target_entity_id: string }
              return [row.proposal_id, row.target_entity_id]
            }),
          )

          await Promise.all(
            dlPropsWithSubject.map((p) => {
              const deadlineId = propToDeadline.get(p.id)
              const subjectId = p.source_payload.__subjectId as string
              if (!deadlineId) return Promise.resolve()
              return attachToSubject('site_deadlines', deadlineId, subjectId)
            }),
          )
        }
      }

      // ── Rattachement sujet choisi → site_decisions.subject_id ───────────────
      // Lit les décisions dont l'opérateur a sélectionné un sujet au moment de l'acceptation
      // (stocké dans source_payload.__subjectId, sans migration).
      {
        const { data: decSubjectProps } = await admin
          .from('document_extraction_proposal')
          .select('id, source_payload')
          .eq('extraction_run_id', runId)
          .in('review_status', ['accepted', 'edited', 'materialized'])
          .eq('proposal_family', 'decision')

        const propsWithSubject = (decSubjectProps ?? []).filter((p) => {
          const sp = p as { id: string; source_payload: Record<string, unknown> | null }
          return typeof sp.source_payload?.__subjectId === 'string'
        }) as Array<{ id: string; source_payload: Record<string, unknown> }>

        if (propsWithSubject.length > 0) {
          const { attachToSubject } = await import('@/lib/db/subjects')

          const propIds = propsWithSubject.map((p) => p.id)
          const { data: matRowsSubj } = await admin
            .from('document_proposal_materialization')
            .select('proposal_id, target_entity_id')
            .in('proposal_id', propIds)
            .eq('target_entity_type', 'site_decision')

          const propToDecision = new Map<string, string>(
            (matRowsSubj ?? []).map((r) => {
              const row = r as { proposal_id: string; target_entity_id: string }
              return [row.proposal_id, row.target_entity_id]
            }),
          )

          await Promise.all(
            propsWithSubject.map((p) => {
              const decisionId = propToDecision.get(p.id)
              const subjectId = p.source_payload.__subjectId as string
              if (!decisionId) return Promise.resolve()
              return attachToSubject('site_decisions', decisionId, subjectId)
            }),
          )
        }
      }

      // Après pipeline TypeScript, statut du run = fully materialized
      await admin
        .from('document_extraction_run')
        .update({ status: 'materialized' })
        .eq('id', runId)
        .eq('status', 'partially_materialized')

      // ── Récit narratif (best-effort) ────────────────────────────────────────
      try {
        const { data: narProps } = await admin
          .from('document_extraction_proposal')
          .select('proposal_family, label, reviewed_label, description, reviewed_description, source_payload')
          .eq('extraction_run_id', runId)
          .in('review_status', ['accepted', 'edited', 'materialized'])
          .in('proposal_family', ['knowledge_fact', 'action', 'deadline', 'decision', 'reservation', 'observation'])

        if (narProps && narProps.length > 0) {
          type NarProp = {
            proposal_family: string; label: string; reviewed_label: string | null
            description: string | null; reviewed_description: string | null
            source_payload: { statusAtDocumentDate?: string } | null
          }
          const proposalsForNarrative = (narProps as NarProp[]).map((p) => ({
            family: p.proposal_family,
            label: p.reviewed_label ?? p.label,
            description: p.reviewed_description ?? p.description ?? null,
            statusAtDocumentDate: (p.source_payload as { statusAtDocumentDate?: string } | null)?.statusAtDocumentDate ?? null,
          }))
          const { generateHistoricalVisitNarrative } = await import('@/lib/documents/historical-visit-narrator')
          const narrative = await generateHistoricalVisitNarrative(proposalsForNarrative)
          if (narrative) {
            const { data: existingSr } = await admin.from('site_reports').select('debrief_analysis').eq('id', siteReportId).maybeSingle()
            const existingDa = (existingSr as { debrief_analysis: Record<string, unknown> | null } | null)?.debrief_analysis ?? {}
            await admin.from('site_reports').update({
              debrief_analysis: {
                ...existingDa,
                historical_summary: {
                  text: narrative,
                  generatedAt: new Date().toISOString(),
                  runId,
                  model: process.env.AI_MODEL ?? 'gemini-2.5-flash',
                },
              },
            }).eq('id', siteReportId)
          }
        }
      } catch {
        // Non bloquant
      }
    }
  } catch {
    // Non bloquant : la visite est créée, le pipeline knowledge est best-effort
  }

  return { ok: true, siteReportId, siteId }
}
