// /EQUIPES V2 (Batch D) — chargement des données du drawer WOW ÉQUIPE.
// Extrait tel quel de l'ancienne app/(dashboard)/equipes/[id]/page.tsx, pour
// être appelé depuis /equipes (page unique) plutôt que depuis une route dédiée.
//
// Retourne `null` sur équipe introuvable OU hors organisation (FAIL-CLOSED) —
// la page appelante n'a alors qu'à ne pas ouvrir le drawer, jamais planter.

import {
  getTeamOverview,
  listTeamFavoriteSites,
  listTeamContractsCovered,
  getTeamRhythm14d,
  getTeamHeatmap90d,
  listTeamCompanions,
  listTeamRecentInterventions,
  listTeamRecentPhotos,
} from '@/lib/db/team-profile'
import { listMembersOfTeam } from '@/lib/db/teams'
import { listFieldMembersOfTeam } from '@/lib/db/team-field-members'
import { getTeamActorInsight } from '@/lib/db/team-actor-insight'
import { listTeamsActivitySummary, type TeamActivitySummary } from '@/lib/db/team-activity-summary'
import { createAdminClient } from '@/lib/supabase/admin'
import { listOrgCatalog } from '@/lib/db/org-catalog'
import type { TeamDrawerData } from './TeamDetailBody'

function ageLabelFromDays(days: number): string {
  if (days < 30) return `${days} jour${days > 1 ? 's' : ''}`
  if (days < 365) {
    const months = Math.floor(days / 30)
    return `${months} mois`
  }
  const years = Math.floor(days / 365)
  const remMonths = Math.floor((days % 365) / 30)
  return remMonths > 0 ? `${years} an${years > 1 ? 's' : ''} et ${remMonths} mois` : `${years} an${years > 1 ? 's' : ''}`
}

export async function loadTeamDrawerData(
  teamId: string,
  orgIds: string[],
): Promise<TeamDrawerData | null> {
  const overview = await getTeamOverview(teamId)
  if (!overview) return null
  // P1 isolation : une équipe d'un autre tenant est invisible, même par id
  // direct — FAIL-CLOSED. FIX MULTI-ORG (revue ChatGPT/Vincent, cc83c29b) —
  // comparer à TOUTES les organisations accessibles au viewer, jamais à
  // `users.organization_id` (une seule org, legacy dès qu'un compte a
  // plusieurs appartenances) : un manager multi-org doit pouvoir ouvrir le
  // drawer d'une équipe qui n'est pas dans son organisation par défaut.
  if (!overview.organizationId || !orgIds.includes(overview.organizationId)) return null
  const organizationId = overview.organizationId

  const [
    favoriteSites,
    contractsCovered,
    rhythm,
    heatmap,
    companions,
    recentInterventions,
    recentPhotos,
    members,
    fieldMembers,
    availableSites,
    specialtyCatalog,
    actorInsight,
    activitySummaries,
  ] = await Promise.all([
    listTeamFavoriteSites(teamId, 8),
    listTeamContractsCovered(teamId),
    getTeamRhythm14d(teamId),
    getTeamHeatmap90d(teamId),
    listTeamCompanions(teamId),
    listTeamRecentInterventions(teamId, 15),
    listTeamRecentPhotos(teamId, 8),
    listMembersOfTeam(teamId),
    listFieldMembersOfTeam(teamId).catch(() => []),
    (async () => {
      const admin = createAdminClient()
      const { data } = await admin
        .from('sites')
        .select('id, name, client:clients(name)')
        .is('deleted_at', null)
        .eq('organization_id', organizationId)
        .order('name', { ascending: true })
      type Row = {
        id: string
        name: string
        client: { name: string } | { name: string }[] | null
      }
      return ((data ?? []) as Row[]).map((s) => {
        const client = Array.isArray(s.client) ? s.client[0] ?? null : s.client
        return { id: s.id, name: s.name, client_name: client?.name ?? null }
      })
    })(),
    listOrgCatalog(organizationId, 'team_specialty'),
    getTeamActorInsight(teamId, [organizationId]),
    listTeamsActivitySummary([teamId]),
  ])

  const activitySummary: TeamActivitySummary =
    activitySummaries.get(teamId) ?? {
      periodDays: 30,
      realInterventionsCount: 0,
      plannedInterventionsCount: 0,
      sitesReallyCoveredCount: 0,
      terrainPhotosCount: 0,
      activeRotationCount: 0,
    }

  return {
    overview,
    activitySummary,
    ageLabel: ageLabelFromDays(overview.ageDays),
    favoriteSites,
    contractsCovered,
    rhythm,
    heatmap,
    companions,
    recentInterventions,
    recentPhotos,
    members,
    fieldMembers,
    availableSites,
    specialtyOptions: specialtyCatalog.map((c) => ({ key: c.key, label: c.label })),
    actorInsight,
  }
}
