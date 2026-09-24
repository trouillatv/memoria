// P0-2A (réalignement) — Matérialisation document → engagement, Porte B
// (chantier, sans AO). Appelle les RPC PostgreSQL
// materialize_engagement_create_new / link_existing (migration 436) via admin
// client, même convention que materializeObligation
// (lib/db/materialize-obligation.ts) et materializeHistoricalVisit.
//
// Deux issues seulement : create_new (nouvel engagement, site_id renseigné,
// tender_id NULL, status='active' directement) et link_existing (rattachement
// à un engagement existant du même chantier/organisation, zéro mutation de
// ses champs métier). La Porte A (AO, tender_id NOT NULL) reste inchangée et
// n'utilise jamais ces RPC.

import { createAdminClient } from '@/lib/supabase/admin'
import type { EngagementCategory } from '@/types/db'

export async function materializeEngagementCreateNew(
  proposalId: string,
  userId: string | null,
  category?: EngagementCategory
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('materialize_engagement_create_new', {
    p_proposal_id: proposalId,
    p_user_id: userId,
    ...(category ? { p_category: category } : {}),
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function materializeEngagementLinkExisting(
  proposalId: string,
  engagementId: string,
  userId: string | null
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('materialize_engagement_link_existing', {
    p_proposal_id: proposalId,
    p_engagement_id: engagementId,
    p_user_id: userId,
  })
  if (error) throw new Error(error.message)
  return data as string
}
