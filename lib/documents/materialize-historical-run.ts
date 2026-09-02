// BATCH-0 — cœur métier de la matérialisation d'une visite historique, extrait
// de createHistoricalVisitAction (review-actions.ts) pour être appelable à la
// fois par la Server Action UI et par un futur orchestrateur batch, sans
// dupliquer les mutations DB. Ne fait aucune vérification d'accès (cookies) et
// ne déclenche pas le post-traitement mémoire : ces deux responsabilités
// restent au choix de l'appelant (after() différé pour l'UI, await direct pour
// le batch — cf. runHistoricalImportPostProcessing).
//
// Pipeline exécuté, identique à l'ancien code inline :
//   materializeHistoricalVisit (RPC)
//   → knowledge_fact → site_knowledge_entries
//   → company/person → companies / company_contacts / site_intervenants
//   → participants (F3-2)
//   → résolution acteurs liés (actions/décisions/réserves/échéances)
//   → rattachement sujet (échéances/décisions)
//   → récit narratif (best-effort)

import { createAdminClient } from '@/lib/supabase/admin'
import { materializeHistoricalVisit } from '@/lib/db/historical-visit-materialization'
import { mergeReportAnalysis } from '@/lib/db/site-reports'
import { projectHistoricalParticipants } from '@/lib/documents/historical-participant-eligibility'
import { detectNonVisitSignal } from '@/lib/documents/detect-document-date'

export type MaterializeHistoricalRunErrorCode =
  | 'MISSING_PARAMS'
  | 'RUN_NOT_FOUND'
  | 'NO_SITE'
  | 'DOCUMENT_NOT_FOUND'
  | 'MISSING_DATE'
  | 'NON_VISIT_SIGNAL'
  | 'MATERIALIZATION_FAILED'

export interface MaterializeHistoricalRunParams {
  runId: string
  documentId: string
  userId: string
  visitTitle?: string | null
  /**
   * Doit être explicitement `true` pour matérialiser un document dont le texte
   * signale une absence de visite terrain (detectNonVisitSignal). Un batch
   * n'a jamais le droit de fixer ce champ automatiquement — cf. doctrine
   * garde non-visite (Finding #1).
   */
  nonVisitAcknowledged?: boolean
}

export interface MaterializeHistoricalRunResult {
  ok: boolean
  siteReportId?: string
  siteId?: string
  visitDate?: string
  message?: string
  error?: string
  errorCode?: MaterializeHistoricalRunErrorCode
}

export async function materializeHistoricalRun(
  params: MaterializeHistoricalRunParams,
): Promise<MaterializeHistoricalRunResult> {
  const { runId, documentId, userId, visitTitle = null, nonVisitAcknowledged = false } = params
  if (!runId || !documentId || !userId) {
    return { ok: false, error: 'Paramètres manquants', errorCode: 'MISSING_PARAMS' }
  }

  const admin = createAdminClient()

  const { data: run } = await admin
    .from('document_extraction_run')
    .select('target_site_id, document_id')
    .eq('id', runId)
    .eq('document_id', documentId)
    .maybeSingle()
  if (!run) return { ok: false, error: 'Run introuvable', errorCode: 'RUN_NOT_FOUND' }

  const siteId = (run as { target_site_id: string | null }).target_site_id
  if (!siteId) {
    return {
      ok: false,
      error: 'Aucun chantier associé à ce run — rattachez le document à un chantier.',
      errorCode: 'NO_SITE',
    }
  }

  const { data: doc } = await admin
    .from('documents')
    .select('effective_date, extracted_text')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!doc) return { ok: false, error: 'Document introuvable', errorCode: 'DOCUMENT_NOT_FOUND' }

  const visitDate = (doc as { effective_date: string | null }).effective_date
  if (!visitDate) {
    return {
      ok: false,
      error: "La date du PV est requise. Modifiez le document pour renseigner la date d'effet.",
      errorCode: 'MISSING_DATE',
    }
  }

  // Finding #1 — un document daté ne prouve pas une visite terrain. Si le texte du
  // document indique explicitement l'absence de visite de site, exiger une confirmation
  // humaine explicite avant de matérialiser cet objet comme visite.
  const extractedText = (doc as { extracted_text: string | null }).extracted_text ?? ''
  const nonVisitSignal = detectNonVisitSignal(extractedText)
  if (nonVisitSignal.detected && !nonVisitAcknowledged) {
    return {
      ok: false,
      error: "Ce document indique explicitement l'absence de visite de site — confirmez avant de créer la visite.",
      errorCode: 'NON_VISIT_SIGNAL',
    }
  }

  let siteReportId: string
  try {
    siteReportId = await materializeHistoricalVisit({
      runId,
      userId,
      siteId,
      visitDate,
      visitTitle,
    })
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Erreur lors de la matérialisation',
      errorCode: 'MATERIALIZATION_FAILED',
    }
  }

  // ── Pipeline post-RPC : knowledge_fact → site_knowledge_entries ──────────
  // Le RPC SQL exclut délibérément ces familles (trop riches pour du PL/pgSQL pur).
  // On les traite ici, en TypeScript, après que la visite est créée.
  // Lot B : destination = site_knowledge_entries (read model), pas captured_knowledge.
  // La thematic_category est propagée depuis la colonne extraite par le LLM.
  try {
    const { data: site } = await admin
      .from('sites')
      .select('organization_id, name, normalized_name')
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
            confirmed_by: userId,
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
                created_by: userId,
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

      // Finding #9 — l'établissement/le site lui-même ne doit jamais devenir une
      // company/site_intervenant (rôle inventé « Établissement »/« Client »). Même garde
      // que l'auto-link des acteurs orphelins (extract-historical-pv.ts), appliquée ici
      // sur le chemin réel de matérialisation.
      const { isSiteEstablishmentLabel } = await import('@/lib/db/site-identity-guard')
      const siteAliases = [
        (site as { name?: string | null } | null)?.name,
        (site as { normalized_name?: string | null } | null)?.normalized_name,
      ]

      for (const rawProp of companyPropsRaw ?? []) {
        const prop = rawProp as { id: string; label: string; reviewed_label: string | null; source_payload: SPCompany | null; stable_key: string | null }
        const companyName = prop.reviewed_label ?? prop.label

        if (isSiteEstablishmentLabel(companyName, siteAliases)) {
          await admin
            .from('document_extraction_proposal')
            .update({ review_status: 'rejected', reviewed_at: new Date().toISOString() })
            .eq('id', prop.id)
          continue
        }

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
          admin.from('document_proposal_materialization').upsert({ organization_id: orgId, proposal_id: prop.id, target_entity_type: 'site_intervenants', target_entity_id: siteIntervenantId, status: 'done', created_by: userId }, { onConflict: 'proposal_id, target_entity_type, target_entity_id', ignoreDuplicates: true }),
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
          admin.from('document_proposal_materialization').upsert({ organization_id: orgId, proposal_id: prop.id, target_entity_type: 'company_contacts', target_entity_id: contactId, status: 'done', created_by: userId }, { onConflict: 'proposal_id, target_entity_type, target_entity_id', ignoreDuplicates: true }),
        ])
      }

      // ── F3-2 : projection des personnes ÉLIGIBLES en participants du rapport ──
      // Passe dédiée sur TOUTES les person proposals (y compris sans entreprise,
      // que le pipeline ci-dessus saute). Seuls les non-null de F3-1 (preuve de
      // participation) deviennent participants : interlocuteur/rôle/mention →
      // inconnu → aucune ligne. contactId RÉUTILISÉ s'il a été résolu ci-dessus ;
      // sinon AUCUNE création de contact (mieux vaut pas de contactId qu'une
      // identité douteuse). Dédup intra-rapport par contactId → nom normalisé,
      // priorité présence/absence explicite > invité > diffusion. Écriture
      // idempotente + non destructive via mergeReportAnalysis (les participants
      // saisis manuellement restent prioritaires et ne sont jamais écrasés).
      {
        const persons = (personPropsRaw ?? []).map((rawProp) => {
          const prop = rawProp as { label: string; reviewed_label: string | null; description: string | null; source_payload: SPPerson | null; stable_key: string | null }
          return {
            label: prop.reviewed_label ?? prop.label,
            description: prop.description,
            presenceVerdict: prop.source_payload?.statusAtDocumentDate ?? null,
            // contactId RÉUTILISÉ si résolu ci-dessus ; sinon undefined (pas de création).
            contactId: prop.stable_key ? stableKeyToContactId.get(prop.stable_key) : undefined,
          }
        })
        const eligibleParticipants = projectHistoricalParticipants(persons)
        if (eligibleParticipants.length > 0) {
          await mergeReportAnalysis(siteReportId, { participants: eligibleParticipants, risks: [] })
        }
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

      // ── Relations inter-sujets ──────────────────────────────────────────────
      // Acquisition DÉPLACÉE dans runHistoricalMemoryBuildPipeline (after occurrences),
      // via produceRelationsFromOccurrences → canonical_subject_links (occurrence-first,
      // terrain-first). L'ancien produceRelationsForRun (proposals → subject_thread_links
      // legacy) tournait ici AVANT que les occurrences n'existent : retiré.
    }
  } catch {
    // Non bloquant : la visite est créée, le pipeline knowledge est best-effort
  }

  // Le succès s'arrête ici : la visite, les captures et les objets métier sont
  // persistés. Le post-traitement mémoire (canonicalisation + similarité) est
  // rejouable et reste au choix de l'appelant (after() différé pour l'UI,
  // await direct pour le batch).
  return {
    ok: true,
    siteReportId,
    siteId,
    visitDate,
    message: 'Visite créée. La mise à jour de la mémoire se poursuit.',
  }
}
