import 'server-only'

// P0 SECURITY — LE SEUL PÉRIMÈTRE CHANTIER DU DOMAINE FIELD.
//
// Jusqu'ici, /chantiers calculait son périmètre une fois, et /today (plus
// `listInterventionsVisibleToUser`) le recalculaient chacun séparément — avec
// un fallback legacy que /chantiers n'a jamais eu : `interventions.team[]`.
// Un compte déplacé d'une organisation à une autre restait cité dans ce
// tableau par d'anciennes interventions, et ce fallback le lui rendait
// accessible en lecture ET en écriture (ensureTodayInterventionsForSites,
// backfill assigned_team_id), bien après la fin de son appartenance réelle.
//
// DOCTRINE (Vincent, 2026-10-02) :
//   · Être assigné à une action ne donne pas accès au chantier.
//   · Une ancienne présence dans interventions.team ne confère pas l'accès.
//   · Une appartenance passée à une organisation ne confère pas l'accès.
//   · Les données legacy ne sont jamais une source d'autorisation.
//   · « Historique != droit d'accès. »
//
// Cette fonction reproduit EXACTEMENT la politique de /chantiers (seule
// référence fonctionnelle) et devient la SEULE source du périmètre chantier
// field. Fail-closed : toute branche sans droit identifié rend `[]`, jamais
// un périmètre élargi.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrganizationMembershipsOfUser } from '@/lib/auth/memberships'
import { listActiveTeamIdsForUser } from '@/lib/db/teams'
import type { DbUser } from '@/types/db'

/**
 * Les chantiers accessibles à CET utilisateur, aujourd'hui, selon le même
 * calcul que /chantiers :
 *   · admin/manager → tous les sites des organisations où il est membre ACTIF ;
 *   · sinon (chef_equipe et autres rôles field) → les sites des missions
 *     affectées à ses équipes ACTIVES (`assigned_team_id`) ;
 *   · aucune appartenance ni équipe active → `[]`.
 *
 * AUCUN fallback vers `interventions.team[]`, `organization_id` legacy, nom/
 * contact/email, ou tout autre historique. Un historique prouve une présence
 * passée, jamais un droit présent.
 */
export async function listAccessibleSiteIdsForUser(
  user: Pick<DbUser, 'id' | 'role'>,
): Promise<string[]> {
  const supabase = createAdminClient()

  const orgIds =
    user.role === 'admin' || user.role === 'manager'
      ? (await getOrganizationMembershipsOfUser({ id: user.id })).map((m) => m.organizationId)
      : []

  if (orgIds.length > 0) {
    const { data } = await supabase
      .from('sites')
      .select('id')
      .in('organization_id', orgIds)
      .is('deleted_at', null)
    return (data ?? []).map((s) => s.id)
  }

  const teamIds = await listActiveTeamIdsForUser(user.id)
  if (teamIds.length === 0) return []

  const { data: missionRows } = await supabase
    .from('missions')
    .select('site_id')
    .in('assigned_team_id', teamIds)
    .is('deleted_at', null)
  const candidateSiteIds = Array.from(
    new Set((missionRows ?? []).map((m) => m.site_id).filter((s): s is string => !!s)),
  )
  if (candidateSiteIds.length === 0) return []

  const { data: siteRows } = await supabase
    .from('sites')
    .select('id')
    .in('id', candidateSiteIds)
    .is('deleted_at', null)
  return (siteRows ?? []).map((s) => s.id)
}
