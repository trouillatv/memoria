// /EQUIPES V2 — FIX 7 (revue ChatGPT/Vincent, cd30aa2d) — Pulse global compact.
//
// Doctrine V2 ABSOLUE (cf. lib/db/teams.ts, lib/db/team-profile.ts) :
//   ✅ Une seule bande compacte, descriptive, org-scopée. Aucun classement,
//      aucune « meilleure équipe », aucune comparaison inter-équipes.
//   ✅ `planned` ne compte JAMAIS comme réalisé — seules les interventions
//      RÉELLES (in_progress/completed/validated) alimentent les compteurs
//      d'activité (interventions, sites couverts, photos).
//   ✅ Requêtes batchées uniquement (pas de N+1) : ce fichier agrège sur TOUTE
//      l'organisation en quelques allers-retours, jamais un par équipe.
//
//   ❌ JAMAIS de détail par équipe ici (cf. team-profile.ts pour la fiche
//      équipe individuelle) — ce module ne retourne qu'un seul bloc global.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { listOrphanUsers } from '@/lib/db/teams'
import { isSystemMissionName } from '@/lib/db/system-missions'
import { REAL_STATUSES } from '@/lib/db/team-profile'

export interface TeamsGlobalPulse {
  periodDays: number
  activeTeamsCount: number
  /** team_members actifs (distinct) + team_field_members actifs (distinct) — jamais dédoublonnés entre les deux populations. */
  activePersonsInTeamsCount: number
  /**
   * FIX C (revue ChatGPT/Vincent, 08e355e2) — deux populations disjointes
   * additionnées (jamais fusionnées) : users sans membership actif dans une
   * équipe ACTIVE (`listOrphanUsers()`) + contacts terrain dans le même cas
   * (`countOrphanContacts`).
   */
  personsWithoutTeamCount: number
  /** Interventions RÉELLES des équipes de l'org sur la période. */
  realInterventionsCount: number
  /** Sites distincts couverts par ces interventions RÉELLES. */
  sitesReallyCoveredCount: number
  /** Photos terrain déposées sur ces interventions, dans la période. */
  terrainPhotosCount: number
}

function emptyPulse(periodDays: number): TeamsGlobalPulse {
  return {
    periodDays,
    activeTeamsCount: 0,
    activePersonsInTeamsCount: 0,
    personsWithoutTeamCount: 0,
    realInterventionsCount: 0,
    sitesReallyCoveredCount: 0,
    terrainPhotosCount: 0,
  }
}

/**
 * Contacts terrain (company_contacts) de l'org qui n'ont aucun membership
 * actif dans une équipe elle-même ACTIVE et non supprimée.
 *
 * FIX C (revue ChatGPT/Vincent, 08e355e2) — « sans équipe » doit couvrir les
 * DEUX populations (users ET contacts terrain), jamais fusionnées par nom ou
 * email : ce sont deux tables distinctes, deux identités distinctes.
 */
async function countOrphanContacts(
  admin: ReturnType<typeof createAdminClient>,
  orgIds: string[],
  activeTeamIds: string[],
): Promise<number> {
  const { data: contacts, error: cErr } = await admin
    .from('company_contacts')
    .select('id')
    .is('deleted_at', null)
    .in('organization_id', orgIds)
  if (cErr) throw cErr
  if (!contacts || contacts.length === 0) return 0
  if (activeTeamIds.length === 0) return contacts.length

  const { data: fieldRows, error: fErr } = await admin
    .from('team_field_members')
    .select('contact_id')
    .in('team_id', activeTeamIds)
    .is('left_at', null)
  if (fErr) throw fErr

  const memberSet = new Set(((fieldRows ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id))
  return (contacts as Array<{ id: string }>).filter((c) => !memberSet.has(c.id)).length
}

/**
 * Pulse global de la page /equipes — une seule bande compacte, tout batché.
 * Fail-closed : sans organisation, tous les compteurs sont à zéro.
 */
export async function getTeamsGlobalPulse(periodDays = 30): Promise<TeamsGlobalPulse> {
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return emptyPulse(periodDays)

  const admin = createAdminClient()

  // 1) Équipes de l'org (non supprimées) — sert de base à tout le reste.
  const { data: teamRows, error: tErr } = await admin
    .from('teams')
    .select('id, active')
    .is('deleted_at', null)
    .in('organization_id', orgIds)
  if (tErr) throw tErr
  const teams = (teamRows ?? []) as Array<{ id: string; active: boolean }>
  const teamIds = teams.map((t) => t.id)
  const activeTeamsCount = teams.filter((t) => t.active).length
  // FIX C (revue ChatGPT/Vincent, 08e355e2) — une équipe désactivée ne doit
  // plus faire compter ses membres comme « en équipe » : toutes les
  // populations ci-dessous se restreignent aux équipes ACTIVES, jamais à
  // `teamIds` (qui inclut aussi les équipes inactives, seulement pas
  // supprimées).
  const activeTeamIds = teams.filter((t) => t.active).map((t) => t.id)

  const [orphanUsersCount, orphanContactsCount, activePersonsInTeamsCount] = await Promise.all([
    listOrphanUsers().then((rows) => rows.length),
    countOrphanContacts(admin, orgIds, activeTeamIds),
    (async () => {
      if (activeTeamIds.length === 0) return 0
      const [{ data: memberRows, error: mErr }, { data: fieldRows, error: fErr }] = await Promise.all([
        admin.from('team_members').select('user_id').in('team_id', activeTeamIds).is('left_at', null),
        admin.from('team_field_members').select('contact_id').in('team_id', activeTeamIds).is('left_at', null),
      ])
      if (mErr) throw mErr
      if (fErr) throw fErr
      const distinctUsers = new Set(((memberRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))
      const distinctContacts = new Set(((fieldRows ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id))
      return distinctUsers.size + distinctContacts.size
    })(),
  ])
  // Deux populations disjointes (users, contacts terrain) additionnées, jamais
  // dédupliquées entre elles — même doctrine que `activePersonsInTeamsCount`.
  const personsWithoutTeamCount = orphanUsersCount + orphanContactsCount

  if (teamIds.length === 0) {
    return {
      periodDays,
      activeTeamsCount,
      activePersonsInTeamsCount,
      personsWithoutTeamCount,
      realInterventionsCount: 0,
      sitesReallyCoveredCount: 0,
      terrainPhotosCount: 0,
    }
  }

  const since = new Date()
  since.setDate(since.getDate() - periodDays)
  const sinceIso = since.toISOString()

  // 2) Interventions RÉELLES des équipes de l'org sur la période — un seul
  // aller-retour, filtré par statut ET date, missions système exclues.
  const { data: interventionRows, error: iErr } = await admin
    .from('interventions')
    .select(`
      id,
      status,
      scheduled_for,
      mission:missions!inner(name, site_id)
    `)
    .in('assigned_team_id', teamIds)
    .in('status', Array.from(REAL_STATUSES))
    .gte('scheduled_for', sinceIso)
  if (iErr) throw iErr

  type Row = {
    id: string
    mission: { name?: string; site_id?: string } | { name?: string; site_id?: string }[] | null
  }
  const pickOne = <T,>(v: T | T[] | null | undefined): T | null =>
    v === null || v === undefined ? null : Array.isArray(v) ? (v[0] as T) ?? null : v

  const interventionIds: string[] = []
  const siteIds = new Set<string>()
  for (const r of (interventionRows ?? []) as Row[]) {
    const mission = pickOne(r.mission) as { name?: string; site_id?: string } | null
    if (!mission?.name || isSystemMissionName(mission.name)) continue
    interventionIds.push(r.id)
    if (mission.site_id) siteIds.add(mission.site_id)
  }

  // 3) Photos terrain déposées dans la période sur ces interventions.
  let terrainPhotosCount = 0
  if (interventionIds.length > 0) {
    const { count, error: pErr } = await admin
      .from('intervention_photos')
      .select('id', { count: 'exact', head: true })
      .in('intervention_id', interventionIds)
      .gte('taken_at', sinceIso)
    if (pErr) throw pErr
    terrainPhotosCount = count ?? 0
  }

  return {
    periodDays,
    activeTeamsCount,
    activePersonsInTeamsCount,
    personsWithoutTeamCount,
    realInterventionsCount: interventionIds.length,
    sitesReallyCoveredCount: siteIds.size,
    terrainPhotosCount,
  }
}
