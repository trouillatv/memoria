// Vue terrain "superviseur" — interventions du jour à l'échelle de l'organisation.
// Utilisée sur /m quand l'utilisateur est manager/admin sans équipe assignée.

import { createAdminClient } from '@/lib/supabase/admin'

export interface OrgTodayIntervention {
  id: string
  missionId: string
  missionName: string
  siteId: string
  siteName: string
  teamName: string | null
  status: string
  slot: string | null
  plannedStart: string | null
  openAnomalyCount: number
}

export interface OrgTodaySite {
  siteId: string
  siteName: string
  interventions: OrgTodayIntervention[]
}

export async function listOrgTodayInterventions(
  orgId: string,
  todayIso: string,
): Promise<OrgTodaySite[]> {
  const sb = createAdminClient()

  // 1. Sites de l'organisation
  const { data: sites } = await sb
    .from('sites')
    .select('id, name')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
  const siteIds = (sites ?? []).map((s) => s.id as string)
  if (siteIds.length === 0) return []

  const siteNameById = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]))

  // 2. Missions sur ces sites (hors traces libres on_demand)
  const { data: missions } = await sb
    .from('missions')
    .select('id, name, site_id, cadence')
    .in('site_id', siteIds)
    .is('deleted_at', null)
  const validMissions = (missions ?? []).filter(
    (m) => (m.cadence as string) !== 'on_demand',
  )
  const missionIds = validMissions.map((m) => m.id as string)
  if (missionIds.length === 0) return []

  const missionById = new Map(
    validMissions.map((m) => [
      m.id as string,
      { name: m.name as string, siteId: m.site_id as string },
    ]),
  )

  // 3. Interventions d'aujourd'hui sur ces missions
  const { data: interventions } = await sb
    .from('interventions')
    .select('id, status, slot, planned_start, assigned_team_id, mission_id')
    .in('mission_id', missionIds)
    .eq('scheduled_for', todayIso)
    .neq('status', 'skipped')
    .order('mission_id')
    .limit(100)
  if (!interventions || interventions.length === 0) return []

  const interventionIds = interventions.map((i) => i.id as string)

  // 4. Anomalies ouvertes par intervention (batch)
  const { data: anomalyRows } = await sb
    .from('intervention_anomalies')
    .select('intervention_id')
    .in('intervention_id', interventionIds)
    .eq('status', 'open')
  const anomalyCountById = new Map<string, number>()
  for (const row of anomalyRows ?? []) {
    const iid = row.intervention_id as string
    anomalyCountById.set(iid, (anomalyCountById.get(iid) ?? 0) + 1)
  }

  // 5. Noms des équipes
  const teamIds = Array.from(
    new Set(
      interventions
        .map((i) => i.assigned_team_id as string | null)
        .filter(Boolean),
    ),
  ) as string[]
  const { data: teams } = teamIds.length > 0
    ? await sb.from('teams').select('id, name').in('id', teamIds)
    : { data: [] }
  const teamNameById = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]))

  // 6. Grouper par site
  const bySite = new Map<string, OrgTodayIntervention[]>()
  for (const i of interventions) {
    const mission = missionById.get(i.mission_id as string)
    if (!mission) continue
    const siteId = mission.siteId
    const iid = i.id as string
    if (!bySite.has(siteId)) bySite.set(siteId, [])
    bySite.get(siteId)!.push({
      id: iid,
      missionId: i.mission_id as string,
      missionName: mission.name,
      siteId,
      siteName: siteNameById.get(siteId) ?? '',
      teamName: i.assigned_team_id
        ? (teamNameById.get(i.assigned_team_id as string) ?? null)
        : null,
      status: i.status as string,
      slot: i.slot as string | null,
      plannedStart: i.planned_start as string | null,
      openAnomalyCount: anomalyCountById.get(iid) ?? 0,
    })
  }

  return Array.from(bySite.entries())
    .map(([siteId, interventions]) => ({
      siteId,
      siteName: siteNameById.get(siteId) ?? '',
      interventions,
    }))
    .sort((a, b) => a.siteName.localeCompare(b.siteName))
}
