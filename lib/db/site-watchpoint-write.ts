import 'server-only'

// Cœur d'écriture de `createCopilotWatchpoint` (P4-E1), extrait de
// `copilot-write-action.ts` pour être appelable HORS contexte HTTP/cookies —
// même raison que `confirmSiteFact` (lib/db/site-fact-write.ts, P4-C) : un
// harnais de recette réversible doit exécuter EXACTEMENT le même chemin
// d'écriture que la server action, sans passer par une session cookie.
//
// `copilot-write-action.ts` reste la SEULE porte d'entrée en production —
// c'est elle qui résout organizationId/userId depuis la session et les
// transmet ici. Ce module ne fait AUCUNE vérification d'accès.
//
// Écrit TOUJOURS avec status='active' (défaut de la table) — la fermeture
// (résolu/converti en réserve) reste un geste humain exclusif, jamais
// proposé ni décidé par ce chemin. Même doctrine que FACT pour le sujet
// canonique : `site_watchpoints` n'a pas de colonne `canonical_subject_id`
// (vérifié, mig 217+262+272+273+274+297+298+319) — un lien de sujet reste un
// enrichissement d'AFFICHAGE porté par le brouillon Copilote, jamais une FK
// inventée ici.

import { createWatchpoint } from '@/lib/db/site-memory-entries'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'

export type ConfirmSiteWatchpointParams = {
  organizationId: string
  siteId: string
  userId: string
  title: string
  body: string | null
  copilotProposalId: string
  interactionId: string | null
}

export type ConfirmSiteWatchpointResult =
  | { ok: true; watchpointId: string }
  | { ok: false; error: string }

export async function confirmSiteWatchpoint(params: ConfirmSiteWatchpointParams): Promise<ConfirmSiteWatchpointResult> {
  const { organizationId, siteId, userId, title, body, copilotProposalId, interactionId } = params
  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'un seul point de vigilance.
  const { data: existing } = await admin
    .from('site_watchpoints')
    .select('id')
    .eq('copilot_proposal_id', copilotProposalId)
    .maybeSingle()
  if (existing) {
    const row = existing as { id: string }
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, watchpointId: row.id }
  }

  try {
    const watchpointId = await createWatchpoint({
      organizationId,
      siteId,
      title,
      body,
      confirmedBy: userId,
      copilotProposalId,
    })
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, watchpointId }
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('duplicate key') || message.includes('23505')) {
      return { ok: false, error: 'Ce point de vigilance est déjà mémorisé.' }
    }
    return { ok: false, error: message || "Impossible d'enregistrer ce point de vigilance." }
  }
}
