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
// DOCTRINE (Vincent, 2026-10-02, durcie le même jour après revue ChatGPT) :
//   · Être assigné à une action ne donne pas accès au chantier.
//   · Une ancienne présence dans interventions.team ne confère pas l'accès.
//   · Une appartenance passée à une organisation ne confère pas l'accès.
//   · Les données legacy ne sont jamais une source d'autorisation.
//   · « Historique != droit d'accès. »
//   · Une `team_members` sans `left_at` ne suffit pas : il faut aussi que
//     l'équipe soit `active`, non `deleted_at`, ET que son organisation soit
//     une organisation où l'utilisateur a une appartenance ACTIVE aujourd'hui.
//     Une team_members stale dans une organisation quittée ne doit jamais
//     redonner un accès fantôme.
//   · Le rôle global (`users.role`) ne fait plus autorité en multi-org : seul
//     le rôle DE CHAQUE appartenance (`organization_memberships.role`) décide,
//     organisation par organisation. Un manager d'ORG_A qui n'est que
//     chef_equipe dans ORG_B ne doit JAMAIS recevoir tous les sites d'ORG_B.
//
// Cette fonction reste la SEULE référence du périmètre chantier field — et la
// SEULE source du résultat consommé par /chantiers, /today et
// listInterventionsVisibleToUser / getChefLaunchState (via
// `listActiveScopedTeamIdsForUser` ci-dessous, pour que ces deux derniers ne
// réimplémentent plus leur propre résolution d'équipes). Fail-closed : toute
// branche sans droit identifié rend `[]`, jamais un périmètre élargi.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrganizationMembershipsOfUser } from '@/lib/auth/memberships'
import type { DbUser } from '@/types/db'

type TeamLite = { active: boolean; deleted_at: string | null; organization_id: string | null }

/**
 * Les équipes ACTIVES de l'utilisateur, après la triple vérification que
 * `team_members.left_at IS NULL` seul ne fait pas : l'équipe doit aussi être
 * `active`, non `deleted_at`, et appartenir à une organisation où
 * l'utilisateur a une appartenance ACTIVE aujourd'hui (`organization_memberships`).
 *
 * Remplace tout usage direct de `listActiveTeamIdsForUser` (lib/db/teams.ts)
 * comme primitive d'autorisation — cette dernière ne vérifie que `left_at`, ce
 * qui laisse passer une team_members stale dans une organisation quittée.
 * `listActiveTeamIdsForUser` reste légitime pour les usages NON
 * autorisation (ex. UI équipes) ; ne pas la réutiliser ici.
 *
 * Même hint de relation que `listOrphanUsers`/`listOrphanContacts`
 * (lib/db/teams.ts) : `teams!team_id!inner(...)` est obligatoire, deux FK
 * `team_members → teams` existent depuis la migration 237 (cf. INCIDENT
 * /equipes 2026-09-30), sans ce hint PostgREST refuse l'embed (PGRST201).
 */
export async function listActiveScopedTeamIdsForUser(userId: string): Promise<string[]> {
  const orgIds = (await getOrganizationMembershipsOfUser({ id: userId })).map((m) => m.organizationId)
  if (orgIds.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, team:teams!team_id!inner(active, deleted_at, organization_id)')
    .eq('user_id', userId)
    .is('left_at', null)
  if (error || !data) return []

  return (data as Array<{ team_id: string; team: TeamLite | TeamLite[] | null }>)
    .filter((r) => {
      const t = Array.isArray(r.team) ? r.team[0] ?? null : r.team
      return !!t && t.active && !t.deleted_at && !!t.organization_id && orgIds.includes(t.organization_id)
    })
    .map((r) => r.team_id)
}

/**
 * Les chantiers accessibles à CET utilisateur, aujourd'hui, selon le même
 * calcul que /chantiers — ÉVALUÉ APPARTENANCE PAR APPARTENANCE, jamais depuis
 * le rôle global :
 *   · pour chaque organisation où l'appartenance ACTIVE porte le rôle
 *     admin/manager → tous les sites actifs de CETTE organisation ;
 *   · en complément (toute appartenance, y compris chef_equipe) → les sites
 *     des missions affectées à ses équipes ACTIVES *et scopées* (cf.
 *     `listActiveScopedTeamIdsForUser`) — redondant mais inoffensif pour une
 *     organisation déjà couverte par le bloc admin/manager, et c'est la SEULE
 *     voie d'accès pour une organisation où le rôle n'est pas admin/manager ;
 *   · aucune appartenance active, ou aucune équipe active scopée → `[]`.
 *
 * AUCUN fallback vers `interventions.team[]`, `users.organization_id` legacy,
 * nom/contact/email, ou tout autre historique. Un historique prouve une
 * présence passée, jamais un droit présent.
 */
export async function listAccessibleSiteIdsForUser(
  user: Pick<DbUser, 'id'>,
): Promise<string[]> {
  const supabase = createAdminClient()
  const memberships = await getOrganizationMembershipsOfUser({ id: user.id })
  if (memberships.length === 0) return []

  const siteIds = new Set<string>()

  const blanketOrgIds = memberships
    .filter((m) => m.role === 'admin' || m.role === 'manager')
    .map((m) => m.organizationId)
  if (blanketOrgIds.length > 0) {
    const { data } = await supabase
      .from('sites')
      .select('id')
      .in('organization_id', blanketOrgIds)
      .is('deleted_at', null)
    for (const s of data ?? []) siteIds.add(s.id)
  }

  const teamIds = await listActiveScopedTeamIdsForUser(user.id)
  if (teamIds.length > 0) {
    const { data: missionRows } = await supabase
      .from('missions')
      .select('site_id')
      .in('assigned_team_id', teamIds)
      .is('deleted_at', null)
    const candidateSiteIds = Array.from(
      new Set((missionRows ?? []).map((m) => m.site_id).filter((s): s is string => !!s)),
    )
    if (candidateSiteIds.length > 0) {
      const { data: siteRows } = await supabase
        .from('sites')
        .select('id')
        .in('id', candidateSiteIds)
        .is('deleted_at', null)
      for (const s of siteRows ?? []) siteIds.add(s.id)
    }
  }

  return Array.from(siteIds)
}
