// Vigilance opérationnelle pour la semaine en cours.
// Deux signaux proactifs :
//   1. Interventions sans équipe affectée (planned / in_progress).
//   2. Conflits "même équipe / même créneau / sites différents" — théoriquement
//      bloqués par findTeamSiteConflict (cf. app/(dashboard)/semaine/actions.ts)
//      mais peuvent exister en data historique (avant le check) ou si insérés
//      manuellement. Ce détecteur est un filet de sécurité a posteriori.
//
// Doctrine : signal ambre, jamais rouge. Format passif descriptif.

import { createAdminClient } from '@/lib/supabase/admin'
import type { InterventionSlot } from '@/types/db'

export interface UnassignedInterventionLite {
  id: string
  scheduled_for: string
  slot: InterventionSlot | null
  mission_name: string
  site_name: string
}

export interface TeamSlotConflict {
  team_id: string
  team_name: string
  scheduled_for: string
  slot: InterventionSlot
  /** Sites distincts couverts par cette équipe sur ce créneau (≥ 2). */
  site_names: string[]
  /** Identifiants des interventions concernées. */
  intervention_ids: string[]
}

export interface WeekVigilance {
  unassigned: UnassignedInterventionLite[]
  conflicts: TeamSlotConflict[]
}

/**
 * Charge les signaux de vigilance pour la fenêtre [start, end] inclusive.
 * Les deux dates sont des yyyy-mm-dd (UTC date logique).
 */
export async function getWeekVigilance(
  startIso: string,
  endIso: string,
): Promise<WeekVigilance> {
  const supabase = createAdminClient()

  // 1) Pull toutes les interventions actives de la fenêtre (planned ou in_progress)
  const { data, error } = await supabase
    .from('interventions')
    .select(
      `id, scheduled_for, slot, assigned_team_id,
       team:teams(id, name),
       mission:missions!inner(name, site:sites!inner(name))`,
    )
    .gte('scheduled_for', startIso)
    .lte('scheduled_for', endIso)
    .in('status', ['planned', 'in_progress'])
  if (error) throw error

  type SiteLite = { name: string }
  type MissionLite = { name: string; site: SiteLite | SiteLite[] | null }
  type TeamLite = { id: string; name: string }
  type Row = {
    id: string
    scheduled_for: string
    slot: InterventionSlot | null
    assigned_team_id: string | null
    team: TeamLite | TeamLite[] | null
    mission: MissionLite | MissionLite[] | null
  }
  const pickOne = <T>(v: T | T[] | null): T | null => {
    if (v === null) return null
    return Array.isArray(v) ? v[0] ?? null : v
  }

  const rows = (data ?? []) as Row[]

  // 2) Non-affectées
  const unassigned: UnassignedInterventionLite[] = []
  for (const r of rows) {
    if (r.assigned_team_id) continue
    const mission = pickOne(r.mission)
    if (!mission) continue
    const site = pickOne(mission.site)
    unassigned.push({
      id: r.id,
      scheduled_for: r.scheduled_for,
      slot: r.slot,
      mission_name: mission.name,
      site_name: site?.name ?? '—',
    })
  }
  unassigned.sort((a, b) => {
    if (a.scheduled_for !== b.scheduled_for) {
      return a.scheduled_for.localeCompare(b.scheduled_for)
    }
    return (a.slot ?? '').localeCompare(b.slot ?? '')
  })

  // 3) Conflits équipe/slot/sites différents
  // Groupe par (team_id, scheduled_for, slot) puis filtre où plusieurs sites
  // distincts apparaissent.
  type Bucket = {
    team_id: string
    team_name: string
    scheduled_for: string
    slot: InterventionSlot
    sites: Map<string, string[]> // site_name → intervention_ids
  }
  const buckets = new Map<string, Bucket>()
  for (const r of rows) {
    if (!r.assigned_team_id || !r.slot) continue
    const team = pickOne(r.team)
    if (!team) continue
    const mission = pickOne(r.mission)
    if (!mission) continue
    const site = pickOne(mission.site)
    if (!site) continue

    const key = `${r.assigned_team_id}|${r.scheduled_for}|${r.slot}`
    const b = buckets.get(key) ?? {
      team_id: r.assigned_team_id,
      team_name: team.name,
      scheduled_for: r.scheduled_for,
      slot: r.slot,
      sites: new Map<string, string[]>(),
    }
    const arr = b.sites.get(site.name) ?? []
    arr.push(r.id)
    b.sites.set(site.name, arr)
    buckets.set(key, b)
  }

  const conflicts: TeamSlotConflict[] = []
  for (const b of buckets.values()) {
    if (b.sites.size < 2) continue
    const intervention_ids = Array.from(b.sites.values()).flat()
    conflicts.push({
      team_id: b.team_id,
      team_name: b.team_name,
      scheduled_for: b.scheduled_for,
      slot: b.slot,
      site_names: Array.from(b.sites.keys()).sort((a, b) =>
        a.localeCompare(b, 'fr', { sensitivity: 'base' }),
      ),
      intervention_ids,
    })
  }
  conflicts.sort((a, b) => {
    if (a.scheduled_for !== b.scheduled_for) {
      return a.scheduled_for.localeCompare(b.scheduled_for)
    }
    return a.slot.localeCompare(b.slot)
  })

  return { unassigned, conflicts }
}
