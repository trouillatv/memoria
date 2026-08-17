import 'server-only'

// Cœur d'écriture de `createCopilotObservation` (P5-F3), extrait de
// `copilot-write-action.ts` pour être appelable HORS contexte HTTP/cookies —
// même raison que `confirmSiteAction` (lib/db/site-action-write.ts, P5-F1) :
// un harnais de recette réversible doit exécuter EXACTEMENT le même chemin
// d'écriture que la server action, sans passer par une session cookie.
//
// `copilot-write-action.ts` reste la SEULE porte d'entrée en production —
// c'est elle qui résout userId depuis la session (via requireSiteAccess) et
// le transmet ici. Ce module ne fait AUCUNE vérification d'accès.
//
// P4-A — canal séparé des autres writers : écrit directement dans
// canonical_subject_occurrence (source_kind='copilot', mig 326), pas dans
// site_actions/visit_preparation/site_scheduled_events. canonical_subject_id
// est NOT NULL en base : un constat sans sujet résolu ne peut pas être
// confirmé (le brouillon n'est même pas construit dans ce cas, voir
// copilot-free-prepare.ts). validation_status='confirmed' d'emblée : cette
// action ne s'exécute qu'après confirmation humaine explicite. Aucune écriture
// de lastMeaningfulChangeAt ici — la doctrine Fact Ledger décide "évolution ou
// pas" après matérialisation, jamais à l'écriture.
//
// Extraction à comportement strictement identique (P5-F3, 2026-08-17) :
// la branche idempotente ci-dessous NE rappelle PAS updateCopilotProposalStatus
// (contrairement à confirmSiteAction) — asymétrie déjà présente dans le code
// original, préservée telle quelle, pas « corrigée ».

import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'
import { todayLocalIso } from '@/lib/time/local-date'

export type ConfirmSiteObservationParams = {
  siteId: string
  userId: string
  canonicalSubjectId: string
  label: string
  body: string | null
  copilotProposalId: string
  interactionId: string | null
}

export type ConfirmSiteObservationResult =
  | { ok: true; occurrenceId: string }
  | { ok: false; error: string }

export async function confirmSiteObservation(params: ConfirmSiteObservationParams): Promise<ConfirmSiteObservationResult> {
  const { siteId, userId, canonicalSubjectId, label, body, copilotProposalId, interactionId } = params
  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'une seule occurrence
  // (miroir de cso_copilot_uniq, mig 326 : canonical_subject_id + source_ref_id).
  const { data: existing } = await admin
    .from('canonical_subject_occurrence')
    .select('id')
    .eq('source_kind', 'copilot')
    .eq('source_ref_id', copilotProposalId)
    .maybeSingle()
  if (existing) return { ok: true, occurrenceId: (existing as { id: string }).id }

  const { data, error } = await admin
    .from('canonical_subject_occurrence')
    .insert({
      canonical_subject_id: canonicalSubjectId,
      site_id: siteId,
      source_kind: 'copilot',
      source_ref_id: copilotProposalId,
      source_proposal_id: null,
      visit_status: null,
      label,
      note: body ?? null,
      evidence_count: 0,
      effective_date: todayLocalIso(),
      created_by: userId,
      validation_status: 'confirmed',
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'Impossible d\'enregistrer ce constat.' }

  const occurrenceId = (data as { id: string }).id
  invalidateSiteProjection(siteId)
  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true, occurrenceId }
}
