// /EQUIPES V2 — vue d'ensemble (Lot visuel 2026-10-01) — résumé d'activité
// PAR équipe, batché sur une liste de teamIds (jamais une requête par équipe).
//
// Doctrine V2 ABSOLUE (cf. lib/db/teams.ts, lib/db/team-profile.ts) :
//   ✅ `planned` ne compte JAMAIS comme réalisé — compté à part, jamais fusionné.
//   ✅ Compteurs DESCRIPTIFS période (30j par défaut), jamais un classement ni
//      un ratio inter-équipes : ce module retourne UNE Map team_id → résumé,
//      la page compose, elle ne compare pas.
//   ✅ Missions système exclues (cf. isSystemMissionName), même filtre que
//      team-pulse.ts et team-profile.ts.
//
// Distinct de lib/db/team-pulse.ts (UN SEUL bloc global agrégé org-wide) et de
// lib/db/team-profile.ts (vue complète d'UNE équipe, non batchée). Ce fichier
// sert la table dense /equipes : N équipes, 3 requêtes au total.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSystemMissionName } from '@/lib/db/system-missions'
import { REAL_STATUSES } from '@/lib/db/team-profile'

const PLANNED_STATUS = 'planned'

export interface TeamActivitySummary {
  periodDays: number
  /** Interventions RÉELLES (in_progress/completed/validated) sur la période. */
  realInterventionsCount: number
  /** Interventions `planned` sur la période — jamais fusionné avec le réel. */
  plannedInterventionsCount: number
  /** Sites distincts couverts par les interventions RÉELLES de la période. */
  sitesReallyCoveredCount: number
  /** Photos terrain déposées sur ces interventions RÉELLES, dans la période. */
  terrainPhotosCount: number
  /** Roulements (planning_cycles non supprimés) distincts où l'équipe tient un slot — pas de notion de période, c'est un état courant. */
  activeRotationCount: number
}

function emptySummary(periodDays: number): TeamActivitySummary {
  return {
    periodDays,
    realInterventionsCount: 0,
    plannedInterventionsCount: 0,
    sitesReallyCoveredCount: 0,
    terrainPhotosCount: 0,
    activeRotationCount: 0,
  }
}

/**
 * Résumé d'activité par équipe, batché. Fail-closed : teamIds vide → Map vide.
 * Une équipe absente du résultat de recherche initiale (aucune intervention,
 * aucun roulement) obtient quand même une entrée à zéro explicite — jamais
 * d'omission silencieuse qui laisserait la page retomber sur un `undefined`.
 */
export async function listTeamsActivitySummary(
  teamIds: string[],
  periodDays = 30,
): Promise<Map<string, TeamActivitySummary>> {
  const out = new Map<string, TeamActivitySummary>()
  if (teamIds.length === 0) return out
  for (const id of teamIds) out.set(id, emptySummary(periodDays))

  const admin = createAdminClient()
  const since = new Date()
  since.setDate(since.getDate() - periodDays)
  const sinceIso = since.toISOString()

  // 1) Interventions (réel + prévu séparés) sur la période, pour toutes les
  // équipes demandées en un seul aller-retour.
  const { data: interventionRows, error: iErr } = await admin
    .from('interventions')
    .select(`
      id,
      assigned_team_id,
      status,
      mission:missions!inner(name, site_id)
    `)
    .in('assigned_team_id', teamIds)
    .in('status', [...REAL_STATUSES, PLANNED_STATUS])
    .gte('scheduled_for', sinceIso)
  if (iErr) throw iErr

  type Row = {
    id: string
    assigned_team_id: string | null
    status: string
    mission: { name?: string; site_id?: string } | { name?: string; site_id?: string }[] | null
  }
  const pickOne = <T,>(v: T | T[] | null | undefined): T | null =>
    v === null || v === undefined ? null : Array.isArray(v) ? (v[0] as T) ?? null : v

  const realInterventionIdsByTeam = new Map<string, string[]>()
  const siteIdsByTeam = new Map<string, Set<string>>()

  for (const r of (interventionRows ?? []) as Row[]) {
    const teamId = r.assigned_team_id
    if (!teamId) continue
    const summary = out.get(teamId)
    if (!summary) continue
    const mission = pickOne(r.mission) as { name?: string; site_id?: string } | null
    if (!mission?.name || isSystemMissionName(mission.name)) continue

    if (REAL_STATUSES.has(r.status)) {
      summary.realInterventionsCount += 1
      const ids = realInterventionIdsByTeam.get(teamId) ?? []
      ids.push(r.id)
      realInterventionIdsByTeam.set(teamId, ids)
      if (mission.site_id) {
        const sites = siteIdsByTeam.get(teamId) ?? new Set<string>()
        sites.add(mission.site_id)
        siteIdsByTeam.set(teamId, sites)
      }
    } else if (r.status === PLANNED_STATUS) {
      summary.plannedInterventionsCount += 1
    }
  }
  for (const [teamId, sites] of siteIdsByTeam) {
    const summary = out.get(teamId)
    if (summary) summary.sitesReallyCoveredCount = sites.size
  }

  // 2) Photos terrain sur les interventions RÉELLES ci-dessus, dans la période.
  const allRealInterventionIds = Array.from(realInterventionIdsByTeam.values()).flat()
  if (allRealInterventionIds.length > 0) {
    const { data: photoRows, error: pErr } = await admin
      .from('intervention_photos')
      .select('intervention_id')
      .in('intervention_id', allRealInterventionIds)
      .gte('taken_at', sinceIso)
    if (pErr) throw pErr

    const teamByInterventionId = new Map<string, string>()
    for (const [teamId, ids] of realInterventionIdsByTeam) {
      for (const id of ids) teamByInterventionId.set(id, teamId)
    }
    for (const row of (photoRows ?? []) as Array<{ intervention_id: string }>) {
      const teamId = teamByInterventionId.get(row.intervention_id)
      if (!teamId) continue
      const summary = out.get(teamId)
      if (summary) summary.terrainPhotosCount += 1
    }
  }

  // 3) Roulements actifs — planning_cycle_slots + planning_cycles non
  // supprimés, batché sur toutes les équipes (même pattern que
  // getTeamDependencies dans lib/db/teams.ts, mais groupé en mémoire).
  const { data: slotRows, error: sErr } = await admin
    .from('planning_cycle_slots')
    .select('team_id, cycle:planning_cycles!inner(id, deleted_at)')
    .in('team_id', teamIds)
  if (sErr) throw sErr

  type SlotRow = {
    team_id: string
    cycle: { id: string; deleted_at: string | null } | { id: string; deleted_at: string | null }[] | null
  }
  const cycleIdsByTeam = new Map<string, Set<string>>()
  for (const row of (slotRows ?? []) as SlotRow[]) {
    const cycle = pickOne(row.cycle) as { id: string; deleted_at: string | null } | null
    if (!cycle || cycle.deleted_at !== null) continue
    const ids = cycleIdsByTeam.get(row.team_id) ?? new Set<string>()
    ids.add(cycle.id)
    cycleIdsByTeam.set(row.team_id, ids)
  }
  for (const [teamId, ids] of cycleIdsByTeam) {
    const summary = out.get(teamId)
    if (summary) summary.activeRotationCount = ids.size
  }

  return out
}
