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
  const { error } = await admin
    .from('document_extraction_evidence')
    .update({ pinned_for_visit: pinned })
    .eq('extraction_run_id', runId)
    .in('evidence_type', ['page_snapshot', 'image'])

  if (error) return { ok: false, error: error.message }
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

      // ── Pipeline : company + person → companies / company_contacts / site_intervenants ──
      const { data: companyPropsRaw } = await admin
        .from('document_extraction_proposal')
        .select('id, label, reviewed_label, source_payload')
        .eq('extraction_run_id', runId)
        .in('review_status', ['accepted', 'edited'])
        .eq('proposal_family', 'company')

      const { data: personPropsRaw } = await admin
        .from('document_extraction_proposal')
        .select('id, label, reviewed_label, description, source_payload')
        .eq('extraction_run_id', runId)
        .in('review_status', ['accepted', 'edited'])
        .eq('proposal_family', 'person')

      type SPCompany = { companyRole?: string; statusAtDocumentDate?: string }
      type SPPerson = { statusAtDocumentDate?: string; linkedCompanyName?: string | null; emailAddress?: string | null; phoneNumber?: string | null }

      const companyMap = new Map<string, { companyId: string; siteIntervenantId: string }>()

      for (const rawProp of companyPropsRaw ?? []) {
        const prop = rawProp as { id: string; label: string; reviewed_label: string | null; source_payload: SPCompany | null }
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
        await Promise.all([
          admin.from('document_extraction_proposal').update({ review_status: 'materialized', reviewed_at: new Date().toISOString() }).eq('id', prop.id),
          admin.from('document_proposal_materialization').upsert({ organization_id: orgId, proposal_id: prop.id, target_entity_type: 'site_intervenants', target_entity_id: siteIntervenantId, status: 'done', created_by: access.userId }, { onConflict: 'proposal_id, target_entity_type, target_entity_id', ignoreDuplicates: true }),
        ])
      }

      for (const rawProp of personPropsRaw ?? []) {
        const prop = rawProp as { id: string; label: string; reviewed_label: string | null; description: string | null; source_payload: SPPerson | null }
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
        await Promise.all([
          admin.from('document_extraction_proposal').update({ review_status: 'materialized', reviewed_at: new Date().toISOString() }).eq('id', prop.id),
          admin.from('document_proposal_materialization').upsert({ organization_id: orgId, proposal_id: prop.id, target_entity_type: 'company_contacts', target_entity_id: contactId, status: 'done', created_by: access.userId }, { onConflict: 'proposal_id, target_entity_type, target_entity_id', ignoreDuplicates: true }),
        ])
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
