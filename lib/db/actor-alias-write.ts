import 'server-only'

// Cœur d'écriture de `createCopilotActorAlias` (P4-B.2), extrait de
// `copilot-write-action.ts` pour être appelable HORS contexte HTTP/cookies —
// nécessaire au harnais de recette réversible (Vincent, 2026-08-17) : un
// script ne peut pas passer par `requireSiteAccess`/`createClient()` (session
// cookie), mais doit exécuter EXACTEMENT le même chemin d'écriture que la
// server action pour que la recette prouve quelque chose.
//
// `copilot-write-action.ts` reste la SEULE porte d'entrée en production —
// c'est elle qui résout organizationId/userId depuis la session et les
// transmet ici. Ce module ne fait AUCUNE vérification d'accès : l'appelant
// doit avoir déjà validé organizationId (requireSiteAccess ou, en recette,
// une résolution service-role explicite hors périmètre utilisateur).

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeActorLabel } from '@/lib/db/actor-alias-resolve'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'

export type ConfirmActorAliasParams = {
  organizationId: string
  userId: string
  alias: string
  targetKind: 'company' | 'contact'
  targetId: string
  aliasNature: 'business_alias' | 'transcription_alias'
  copilotProposalId: string
  interactionId: string | null
  /** 'copilot' en production. Un harnais de recette DOIT passer une valeur distincte (ex. 'copilot_test') pour rester repérable et révocable sans ambiguïté. */
  source?: string
}

export type ConfirmActorAliasResult =
  | { ok: true; aliasId: string }
  | { ok: false; error: string }

export async function confirmActorAlias(params: ConfirmActorAliasParams): Promise<ConfirmActorAliasResult> {
  const { organizationId, userId, alias, targetKind, targetId, aliasNature, copilotProposalId, interactionId } = params
  const source = params.source ?? 'copilot'
  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut confirmer qu'une seule correspondance.
  const { data: existing } = await admin
    .from('actor_alias')
    .select('id, status')
    .eq('copilot_proposal_id', copilotProposalId)
    .maybeSingle()
  if (existing) {
    const row = existing as { id: string; status: string }
    if (row.status !== 'confirmed') {
      await admin
        .from('actor_alias')
        .update({ status: 'confirmed', confirmed_by: userId, confirmed_at: new Date().toISOString() })
        .eq('id', row.id)
    }
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, aliasId: row.id }
  }

  // Revérification serveur de la cible — jamais la parole du client.
  if (targetKind === 'company') {
    const { data: company } = await admin
      .from('companies')
      .select('id')
      .eq('id', targetId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!company) return { ok: false, error: 'Acteur introuvable dans cette organisation.' }
  } else {
    const { data: contact } = await admin
      .from('company_contacts')
      .select('id')
      .eq('id', targetId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!contact) return { ok: false, error: 'Acteur introuvable dans cette organisation.' }
  }

  const { data, error } = await admin
    .from('actor_alias')
    .insert({
      organization_id: organizationId,
      company_id: targetKind === 'company' ? targetId : null,
      contact_id: targetKind === 'contact' ? targetId : null,
      alias,
      alias_norm: normalizeActorLabel(alias),
      alias_nature: aliasNature,
      status: 'confirmed',
      source,
      copilot_proposal_id: copilotProposalId,
      copilot_interaction_id: interactionId ?? null,
      created_by: userId,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) {
    if (error?.code === '23505') return { ok: false, error: 'Cette correspondance est déjà mémorisée pour cet acteur.' }
    return { ok: false, error: error?.message ?? "Impossible d'enregistrer cette correspondance." }
  }

  const aliasId = (data as { id: string }).id
  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true, aliasId }
}
