// P0-2A (réalignement) — Matérialisation document → engagement, Porte B
// (chantier, sans AO). Appelle les RPC PostgreSQL
// materialize_engagement_create_new / link_existing (migration 436) via admin
// client, même convention que materializeObligation
// (lib/db/materialize-obligation.ts) et materializeHistoricalVisit.
//
// Deux issues seulement : create_new (nouvel engagement, site_id renseigné,
// tender_id NULL, status='curated' — validation de l'extraction, PAS
// activation, cf. migration 437) et link_existing (rattachement à un
// engagement existant du même chantier/organisation, zéro mutation de ses
// champs métier). L'activation ('curated' → 'active') est un geste séparé,
// cf. lib/db/engagements.ts::activateEngagement. La Porte A (AO, tender_id
// NOT NULL) reste inchangée et n'utilise jamais ces RPC.

import { createAdminClient } from '@/lib/supabase/admin'
import type { EngagementCategory, EngagementKind } from '@/types/db'

export async function materializeEngagementCreateNew(
  proposalId: string,
  userId: string | null,
  category: EngagementCategory,
  kind: EngagementKind,
  measurable: boolean
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('materialize_engagement_create_new', {
    p_proposal_id: proposalId,
    p_user_id: userId,
    p_category: category,
    p_kind: kind,
    p_measurable: measurable,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/**
 * La RPC retourne l'ID de la ligne document_proposal_materialization, pas
 * l'ID de l'Engagement (cf. migration 436 : `RETURN v_mat_id`/`v_existing_
 * mat_id`). L'Engagement cible est déjà connu de l'appelant — c'est le
 * paramètre d'entrée — on le retourne directement plutôt que la valeur brute
 * de la RPC, pour ne jamais faire croire qu'un ID de matérialisation est un
 * ID d'Engagement.
 */
export async function materializeEngagementLinkExisting(
  proposalId: string,
  engagementId: string,
  userId: string | null
): Promise<string> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('materialize_engagement_link_existing', {
    p_proposal_id: proposalId,
    p_engagement_id: engagementId,
    p_user_id: userId,
  })
  if (error) throw new Error(error.message)
  return engagementId
}
