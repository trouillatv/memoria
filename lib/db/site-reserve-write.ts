import 'server-only'

// Cœur d'écriture de `createCopilotReserve` (P4-E3), extrait de
// `copilot-write-action.ts` pour être appelable HORS contexte HTTP/cookies —
// même raison que `confirmSiteDeadline` (lib/db/site-deadline-write.ts, P4-E2)
// et `confirmSiteWatchpoint` (P4-E1) : un harnais de recette réversible doit
// exécuter EXACTEMENT le même chemin d'écriture que la server action, sans
// passer par une session cookie.
//
// `copilot-write-action.ts` reste la SEULE porte d'entrée en production —
// c'est elle qui résout organizationId/userId depuis la session (via
// requireSiteWriteAccess) et les transmet ici. Ce module ne fait AUCUNE
// vérification d'accès.
//
// Doctrine Vincent (P4-E3, 2026-08-17) : pas de gravité inventée, pas de
// due_date, pas de responsable personne (issuedBy=null), pas de
// canonical_subject_id forcé ici — createSiteReserve() le résout lui-même en
// best-effort (mig 347, P1-C2B.2). issuedOn = date du jour (todayLocalIso),
// même pattern que createCopilotObservation (effective_date).

import { createSiteReserve } from '@/lib/db/site-reserve'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'
import { todayLocalIso } from '@/lib/time/local-date'

export type ConfirmSiteReserveParams = {
  organizationId: string
  siteId: string
  userId: string
  label: string
  copilotProposalId: string
  interactionId: string | null
}

export type ConfirmSiteReserveResult =
  | { ok: true; reserveId: string }
  | { ok: false; error: string }

export async function confirmSiteReserve(params: ConfirmSiteReserveParams): Promise<ConfirmSiteReserveResult> {
  const { organizationId, siteId, userId, label, copilotProposalId, interactionId } = params
  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'une seule réserve.
  const { data: existing } = await admin
    .from('site_reserve')
    .select('id')
    .eq('copilot_proposal_id', copilotProposalId)
    .maybeSingle()
  if (existing) {
    const row = existing as { id: string }
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, reserveId: row.id }
  }

  try {
    const { id: reserveId } = await createSiteReserve({
      siteId,
      label,
      location: null,
      issuedBy: null,
      issuedOn: todayLocalIso(),
      userId,
      organizationId,
      copilotProposalId,
    })
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, reserveId }
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('duplicate key') || message.includes('23505')) {
      return { ok: false, error: 'Cette réserve est déjà mémorisée.' }
    }
    return { ok: false, error: message || "Impossible d'enregistrer cette réserve." }
  }
}
