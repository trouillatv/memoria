import 'server-only'

// Cœur d'écriture de `createCopilotFact` (P4-C), extrait de
// `copilot-write-action.ts` pour être appelable HORS contexte HTTP/cookies —
// même raison que `confirmActorAlias` (lib/db/actor-alias-write.ts, P4-B.2) :
// un harnais de recette réversible doit exécuter EXACTEMENT le même chemin
// d'écriture que la server action, sans passer par une session cookie.
//
// `copilot-write-action.ts` reste la SEULE porte d'entrée en production —
// c'est elle qui résout organizationId/userId depuis la session et les
// transmet ici. Ce module ne fait AUCUNE vérification d'accès.
//
// Écrit DIRECTEMENT dans site_knowledge_entries (kind=knowledge existant),
// jamais via site_knowledge_proposals — cette dernière reste réservée aux
// propositions issues de l'analyse asynchrone de visite (cadrage Vincent,
// P4-C). La nature (current_information/durable_knowledge) est fournie par
// l'appelant : elle a été choisie par l'humain en amont, jamais déduite ici.

import { createKnowledgeEntry } from '@/lib/db/site-memory-entries'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'

export type ConfirmSiteFactParams = {
  organizationId: string
  siteId: string
  userId: string
  kind: 'current_information' | 'durable_knowledge'
  title: string
  body: string | null
  copilotProposalId: string
  interactionId: string | null
}

export type ConfirmSiteFactResult =
  | { ok: true; entryId: string }
  | { ok: false; error: string }

export async function confirmSiteFact(params: ConfirmSiteFactParams): Promise<ConfirmSiteFactResult> {
  const { organizationId, siteId, userId, kind, title, body, copilotProposalId, interactionId } = params
  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'une seule entrée.
  const { data: existing } = await admin
    .from('site_knowledge_entries')
    .select('id')
    .eq('copilot_proposal_id', copilotProposalId)
    .maybeSingle()
  if (existing) {
    const row = existing as { id: string }
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, entryId: row.id }
  }

  try {
    const entryId = await createKnowledgeEntry({
      organizationId,
      siteId,
      kind,
      title,
      body,
      confirmedBy: userId,
      copilotProposalId,
    })
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, entryId }
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('duplicate key') || message.includes('23505')) {
      return { ok: false, error: 'Cette information est déjà mémorisée.' }
    }
    return { ok: false, error: message || "Impossible d'enregistrer cette information." }
  }
}
