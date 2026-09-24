// P0-2A — Matérialisation document → obligation (CCTP/CCAP), sans extracteur.
// Appelle les RPC PostgreSQL materialize_obligation_create_new / link_existing
// (migration 435) via admin client, même convention que materializeHistoricalVisit
// (lib/db/historical-visit-materialization.ts).
//
// Deux issues seulement : create_new (nouvelle site_obligation) et link_existing
// (rattachement à une obligation existante, zéro mutation de ses champs métier).
// Toute décision de mise à jour/suppression/réconciliation automatique d'une
// obligation existante reste hors périmètre (voir migration 435, audit
// historisation site_obligation).

import { createAdminClient } from '@/lib/supabase/admin'

export async function materializeObligationCreateNew(
  proposalId: string,
  userId: string | null
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('materialize_obligation_create_new', {
    p_proposal_id: proposalId,
    p_user_id: userId,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function materializeObligationLinkExisting(
  proposalId: string,
  obligationId: string,
  userId: string | null
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('materialize_obligation_link_existing', {
    p_proposal_id: proposalId,
    p_obligation_id: obligationId,
    p_user_id: userId,
  })
  if (error) throw new Error(error.message)
  return data as string
}
