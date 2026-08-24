import 'server-only'

// Cœur d'écriture de `createCopilotAction` (P5-F1), extrait de
// `copilot-write-action.ts` pour être appelable HORS contexte HTTP/cookies —
// même raison que `confirmSiteDeadline` (lib/db/site-deadline-write.ts, P4-E2)
// et `confirmSiteReserve` (lib/db/site-reserve-write.ts, P4-E3) : un harnais
// de recette réversible doit exécuter EXACTEMENT le même chemin d'écriture
// que la server action, sans passer par une session cookie.
//
// `copilot-write-action.ts` reste la SEULE porte d'entrée en production —
// c'est elle qui résout userId depuis la session (via requireSiteAccess) et
// le transmet ici. Ce module ne fait AUCUNE vérification d'accès.
//
// Doctrine Vincent (P5-F1, 2026-08-17) : `dueDate` vient du brouillon éditable
// par l'humain avant confirmation (même que deadlineDueDate) — jamais une
// date inventée. `due_date_status='explicit'` quand une date est présente,
// même convention que la saisie manuelle humaine (addActionAction,
// app/(dashboard)/meetings/[id]/pv-actions.ts).

import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'
import { resolveSubjectAndAttachCanonicalBusinessObject } from '@/lib/db/canonical-business-object-attach'

export type ConfirmSiteActionParams = {
  siteId: string
  userId: string
  title: string
  body: string | null
  dueDate: string | null
  copilotProposalId: string
  llmModel: string
  promptVersion: string
  interactionId: string | null
}

export type ConfirmSiteActionResult =
  | { ok: true; actionId: string }
  | { ok: false; error: string }

export async function confirmSiteAction(params: ConfirmSiteActionParams): Promise<ConfirmSiteActionResult> {
  const { siteId, userId, title, body, dueDate, copilotProposalId, llmModel, promptVersion, interactionId } = params
  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'une seule action.
  const { data: existing } = await admin
    .from('site_actions')
    .select('id')
    .eq('copilot_proposal_id', copilotProposalId)
    .maybeSingle()
  if (existing) {
    const row = existing as { id: string }
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, actionId: row.id }
  }

  const { data, error } = await admin
    .from('site_actions')
    .insert({
      site_id: siteId,
      title,
      body: body ?? null,
      status: 'open',
      due_date: dueDate ?? null,
      due_date_status: dueDate ? 'explicit' : null,
      created_by: userId,
      created_from: 'copilot',
      copilot_proposal_id: copilotProposalId,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
      llm_model: llmModel,
      prompt_version: promptVersion,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? "Impossible de créer cette action." }

  const actionId = (data as { id: string }).id
  invalidateSiteProjection(siteId)
  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')

  // Non-bloquant : rattache l'action à son sujet canonique puis à son canonical_business_object
  // (mig 346, P1-3C.1 ; P1-C2B.2). Ce chemin fait son propre insert (ne passe pas par
  // createSiteAction), d'où l'appel explicite au même helper partagé que les autres writers.
  void resolveSubjectAndAttachCanonicalBusinessObject({
    siteId,
    entityType: 'site_action',
    entityId: actionId,
    label: title,
    date: dueDate ?? null,
  })

  return { ok: true, actionId }
}
