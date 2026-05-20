import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InterventionSlot } from '@/types/db'

// =============================================================================
// Helper partagé : détection de conflit team-site
// =============================================================================
//
// Règle métier (Vincent 2026-05-12, étendue V6.1 le 2026-05-20) :
//
//   Une équipe ne peut PAS être affectée à deux SITES DIFFÉRENTS sur des
//   horaires qui se chevauchent. Même équipe / même site = OK (mission
//   multiple ou interventions en cascade sur le même lieu).
//
//   Avant V6.1 : 'même créneau' (matin/après-midi/soir) = conflit.
//   Après V6.1 : si les deux côtés ont planned_start + planned_end, on
//   compare l'intersection des plages horaires [start, end]. Sinon
//   fallback au critère slot grossier.
//
//   Le chevauchement strict (a1 < b2 && b1 < a2) signifie que fin = début
//   de l'autre est OK (l'équipe peut enchaîner).
//
// Doctrine V6.1 préservée : on compare PAR INTERVENTION (planned_start /
// planned_end de chaque côté), JAMAIS on n'agrège par user_id. Pas de
// notion d'heures cumulées par personne ici.

export async function findTeamSiteConflict(args: {
  /** Admin client Supabase déjà initialisé côté caller. */
  admin: ReturnType<typeof createAdminClient>
  teamId: string
  /** Mission de l'intervention source — pour résoudre son site_id et l'exclure. */
  missionId: string
  scheduledFor: string
  slot: InterventionSlot
  /** Heures précises de l'intervention source. Si fournies des deux côtés,
   *  on compare l'intersection des plages [start, end] (V6.1).
   *  Sinon fallback au critère slot identique. */
  sourcePlannedStart?: string | null
  sourcePlannedEnd?: string | null
  /** Pour exclure l'intervention en cours de modification de la recherche. */
  excludeInterventionId: string
}): Promise<{ siteName: string; teamName: string } | null> {
  // 1) Résoudre le site de la mission source (à exclure des conflits — on ne
  //    bloque pas une équipe qui enchaîne sur le même site).
  const { data: sourceMission } = await args.admin
    .from('missions')
    .select('site_id')
    .eq('id', args.missionId)
    .maybeSingle()
  const sourceSiteId = (sourceMission as { site_id?: string } | null)?.site_id

  // 2) Récupérer toutes les interventions actives de cette équipe ce JOUR
  //    (on ne filtre plus par slot — comparaison fine en JS).
  const { data: candidates, error } = await args.admin
    .from('interventions')
    .select(
      `id, mission_id, assigned_team_id, slot, planned_start, planned_end,
       team:teams(name),
       mission:missions!inner(site_id, site:sites!inner(id, name))`,
    )
    .neq('id', args.excludeInterventionId)
    .eq('assigned_team_id', args.teamId)
    .eq('scheduled_for', args.scheduledFor)
    .in('status', ['planned', 'in_progress'])
  if (error) throw error

  for (const row of (candidates ?? []) as Array<{
    slot: string | null
    planned_start: string | null
    planned_end: string | null
    mission: { site: { id: string; name: string } | { id: string; name: string }[] | null } | Array<{ site: { id: string; name: string } | { id: string; name: string }[] | null }> | null
    team: { name: string } | { name: string }[] | null
  }>) {
    const mission = Array.isArray(row.mission) ? row.mission[0] : row.mission
    if (!mission) continue
    const site = Array.isArray(mission.site) ? mission.site[0] : mission.site
    if (!site) continue
    // Pas de conflit si même site (multi-mission sur même lieu = OK).
    if (site.id === sourceSiteId) continue

    // Chevauchement temporel V6.1 :
    //  - Si les DEUX ont planned_end → intersection plage [start, end]
    //  - Sinon → fallback critère slot identique
    const candHasRange = !!row.planned_start && !!row.planned_end
    const srcHasRange = !!args.sourcePlannedStart && !!args.sourcePlannedEnd
    let overlaps: boolean
    if (candHasRange && srcHasRange) {
      const a1 = new Date(row.planned_start as string).getTime()
      const a2 = new Date(row.planned_end as string).getTime()
      const b1 = new Date(args.sourcePlannedStart as string).getTime()
      const b2 = new Date(args.sourcePlannedEnd as string).getTime()
      overlaps = a1 < b2 && b1 < a2
    } else {
      overlaps = row.slot === args.slot
    }
    if (!overlaps) continue

    const team = Array.isArray(row.team) ? row.team[0] : row.team
    return { siteName: site.name, teamName: team?.name ?? 'l\'équipe' }
  }
  return null
}

// =============================================================================
// Bulk : pour une (date, slot) donnée, retourne pour CHAQUE équipe occupée
// le site sur lequel elle est déjà affectée. Utilisé par la page détail
// intervention pour afficher des warnings "déjà sur X" dans le dialog de
// réassignation. Cohérent avec V6.1 — compare par chevauchement horaire si
// dispo, fallback slot sinon.
// =============================================================================

export async function listTeamConflictsForSlot(args: {
  admin: ReturnType<typeof createAdminClient>
  scheduledFor: string
  slot: InterventionSlot | null
  /** Heures précises de l'intervention source (pour fenêtre de comparaison). */
  sourcePlannedStart?: string | null
  sourcePlannedEnd?: string | null
  /** Intervention à exclure (la source). */
  excludeInterventionId: string
  /** Site source — les équipes qui sont déjà sur ce site ne sont PAS marquées
   *  en conflit (multi-mission sur même lieu = OK). */
  sourceSiteId: string | null
}): Promise<Map<string, string>> {
  const conflicts = new Map<string, string>()
  if (!args.slot && !args.sourcePlannedStart) return conflicts

  const { data, error } = await args.admin
    .from('interventions')
    .select(
      `assigned_team_id, slot, planned_start, planned_end,
       mission:missions!inner(site:sites!inner(id, name))`,
    )
    .eq('scheduled_for', args.scheduledFor)
    .in('status', ['planned', 'in_progress'])
    .neq('id', args.excludeInterventionId)
    .not('assigned_team_id', 'is', null)
  if (error) throw error

  const srcHasRange = !!args.sourcePlannedStart && !!args.sourcePlannedEnd

  for (const row of (data ?? []) as Array<{
    assigned_team_id: string
    slot: string | null
    planned_start: string | null
    planned_end: string | null
    mission: { site: { id: string; name: string } | { id: string; name: string }[] | null } | Array<{ site: { id: string; name: string } | { id: string; name: string }[] | null }> | null
  }>) {
    const mission = Array.isArray(row.mission) ? row.mission[0] : row.mission
    if (!mission) continue
    const site = Array.isArray(mission.site) ? mission.site[0] : mission.site
    if (!site) continue
    // Pas de conflit si même site
    if (args.sourceSiteId && site.id === args.sourceSiteId) continue

    const candHasRange = !!row.planned_start && !!row.planned_end
    let overlaps: boolean
    if (candHasRange && srcHasRange) {
      const a1 = new Date(row.planned_start as string).getTime()
      const a2 = new Date(row.planned_end as string).getTime()
      const b1 = new Date(args.sourcePlannedStart as string).getTime()
      const b2 = new Date(args.sourcePlannedEnd as string).getTime()
      overlaps = a1 < b2 && b1 < a2
    } else {
      overlaps = row.slot === args.slot
    }
    if (!overlaps) continue

    if (!conflicts.has(row.assigned_team_id)) {
      conflicts.set(row.assigned_team_id, site.name)
    }
  }
  return conflicts
}
