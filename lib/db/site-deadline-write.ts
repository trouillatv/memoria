import 'server-only'

// Cœur d'écriture de `createCopilotDeadline` (P4-E2), extrait de
// `copilot-write-action.ts` pour être appelable HORS contexte HTTP/cookies —
// même raison que `confirmSiteWatchpoint` (lib/db/site-watchpoint-write.ts,
// P4-E1) : un harnais de recette réversible doit exécuter EXACTEMENT le même
// chemin d'écriture que la server action, sans passer par une session cookie.
//
// `copilot-write-action.ts` reste la SEULE porte d'entrée en production —
// c'est elle qui résout organizationId/userId depuis la session et les
// transmet ici. Ce module ne fait AUCUNE vérification d'accès.
//
// `due_date` null reste un état valide (« à planifier », doctrine mig 215) —
// createSiteDeadline dérive status='to_plan' dans ce cas, jamais une erreur.
// P1-3C.1 (mig 346) : `site_deadlines` a désormais une colonne `canonical_subject_id`.
// Le lien (puis le rattachement canonical_business_object, P1-C2B.2) est résolu de
// façon non-bloquante DANS createSiteDeadline() — pas ici, pour couvrir tous les appelants.

import { createSiteDeadline } from '@/lib/db/site-deadlines'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'

export type ConfirmSiteDeadlineParams = {
  organizationId: string
  siteId: string
  userId: string
  title: string
  constraintText: string | null
  dueDate: string | null
  copilotProposalId: string
  interactionId: string | null
}

export type ConfirmSiteDeadlineResult =
  | { ok: true; deadlineId: string }
  | { ok: false; error: string }

export async function confirmSiteDeadline(params: ConfirmSiteDeadlineParams): Promise<ConfirmSiteDeadlineResult> {
  const { organizationId, siteId, userId, title, constraintText, dueDate, copilotProposalId, interactionId } = params
  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'une seule échéance.
  const { data: existing } = await admin
    .from('site_deadlines')
    .select('id')
    .eq('copilot_proposal_id', copilotProposalId)
    .maybeSingle()
  if (existing) {
    const row = existing as { id: string }
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, deadlineId: row.id }
  }

  try {
    const deadlineId = await createSiteDeadline({
      site_id: siteId,
      organization_id: organizationId,
      title,
      constraint_text: constraintText,
      due_date: dueDate,
      created_by: userId,
      created_from: 'copilot',
      copilot_proposal_id: copilotProposalId,
    })
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')

    // Rattachement sujet canonique + canonical_business_object désormais fait par
    // createSiteDeadline() lui-même (P1-C2B.2) — plus de résolution dupliquée ici.

    return { ok: true, deadlineId }
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('duplicate key') || message.includes('23505')) {
      return { ok: false, error: 'Cette échéance est déjà mémorisée.' }
    }
    return { ok: false, error: message || "Impossible d'enregistrer cette échéance." }
  }
}
