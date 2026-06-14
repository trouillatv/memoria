// lib/db/missions-cockpit.ts
// Cockpit "Missions" — vue modèles de travail avec stats d'exécution.
//
// Doctrine : Mission = template/modèle. Intervention = occurrence datée.
// Ce helper remonte les missions avec : dernière exécution, prochaine planifiée,
// équipe affectée, anomalies ouvertes. Pas d'informations par agent individuel.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso } from '@/lib/time/local-date'
import type { MissionCadence } from '@/types/db'

export interface MissionCockpitRow {
  id: string
  name: string
  cadence: MissionCadence
  active: boolean
  siteId: string
  siteName: string
  contractId: string | null
  contractName: string | null
  assignedTeam: { id: string; name: string; color: string | null } | null
  lastInterventionDate: string | null
  nextInterventionDate: string | null
  openAnomalyCount: number
}

export interface MissionCockpitStats {
  total: number
  withoutNextIntervention: number
  withoutTeam: number
  withAnomalies: number
}

export async function listMissionsCockpit(): Promise<{
  missions: MissionCockpitRow[]
  stats: MissionCockpitStats
}> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const today = todayLocalIso()

  // 1. Sites de l'organisation (avec infos contrat)
  let sitesQ = supabase
    .from('sites')
    .select('id, name, contract:contracts(id, name)')
    .is('deleted_at', null)
  if (orgId) sitesQ = sitesQ.eq('organization_id', orgId)
  const { data: siteRows } = await sitesQ

  const siteIds = (siteRows ?? []).map((s) => (s as { id: string }).id)
  if (siteIds.length === 0) {
    return { missions: [], stats: { total: 0, withoutNextIntervention: 0, withoutTeam: 0, withAnomalies: 0 } }
  }

  type ContractRow = { id: string; name: string }
  const siteById = new Map<string, { name: string; contractId: string | null; contractName: string | null }>()
  for (const s of (siteRows ?? []) as Array<{ id: string; name: string; contract: ContractRow | ContractRow[] | null }>) {
    const contract = Array.isArray(s.contract) ? (s.contract[0] ?? null) : s.contract
    siteById.set(s.id, {
      name: s.name,
      contractId: contract?.id ?? null,
      contractName: contract?.name ?? null,
    })
  }

  // 2. Missions de ces sites
  const { data: missionRows } = await supabase
    .from('missions')
    .select('id, name, cadence, active, assigned_team_id, site_id')
    .in('site_id', siteIds)
    .is('deleted_at', null)
    .order('name')

  type MissionRow = { id: string; name: string; cadence: MissionCadence; active: boolean; assigned_team_id: string | null; site_id: string }
  const missions = (missionRows ?? []) as MissionRow[]
  if (missions.length === 0) {
    return { missions: [], stats: { total: 0, withoutNextIntervention: 0, withoutTeam: 0, withAnomalies: 0 } }
  }

  const missionIds = missions.map((m) => m.id)

  // 3. Équipes affectées (batch par IDs uniques)
  const teamIdSet = new Set(missions.map((m) => m.assigned_team_id).filter((id): id is string => !!id))
  const teamById = new Map<string, { id: string; name: string; color: string | null }>()
  if (teamIdSet.size > 0) {
    const { data: teamRows } = await supabase
      .from('teams')
      .select('id, name, color')
      .in('id', [...teamIdSet])
    for (const t of (teamRows ?? []) as Array<{ id: string; name: string; color: string | null }>) {
      teamById.set(t.id, t)
    }
  }

  // 4. Dernière intervention exécutée + prochaine planifiée par mission (batch)
  const [lastRes, nextRes, inProgressRes] = await Promise.all([
    supabase
      .from('interventions')
      .select('id, mission_id, scheduled_for')
      .in('mission_id', missionIds)
      .in('status', ['completed', 'validated'])
      .not('scheduled_for', 'is', null)
      .order('scheduled_for', { ascending: false })
      .limit(2000),
    supabase
      .from('interventions')
      .select('id, mission_id, scheduled_for')
      .in('mission_id', missionIds)
      .eq('status', 'planned')
      .gte('scheduled_for', today)
      .order('scheduled_for', { ascending: true })
      .limit(2000),
    supabase
      .from('interventions')
      .select('id, mission_id')
      .in('mission_id', missionIds)
      .eq('status', 'in_progress'),
  ])

  type IntvRow = { id: string; mission_id: string; scheduled_for?: string }
  const lastByMission = new Map<string, string>()
  for (const r of (lastRes.data ?? []) as IntvRow[]) {
    if (r.scheduled_for && !lastByMission.has(r.mission_id)) {
      lastByMission.set(r.mission_id, r.scheduled_for)
    }
  }
  const nextByMission = new Map<string, string>()
  for (const r of (nextRes.data ?? []) as IntvRow[]) {
    if (r.scheduled_for && !nextByMission.has(r.mission_id)) {
      nextByMission.set(r.mission_id, r.scheduled_for)
    }
  }

  // 5. Anomalies ouvertes par mission — via les interventions déjà chargées
  const interventionToMission = new Map<string, string>()
  for (const r of (lastRes.data ?? []) as IntvRow[]) interventionToMission.set(r.id, r.mission_id)
  for (const r of (nextRes.data ?? []) as IntvRow[]) interventionToMission.set(r.id, r.mission_id)
  for (const r of (inProgressRes.data ?? []) as IntvRow[]) interventionToMission.set(r.id, r.mission_id)

  const anomalyCountByMission = new Map<string, number>()
  const knownIntvIds = [...interventionToMission.keys()]
  if (knownIntvIds.length > 0) {
    const { data: anomalyRows } = await supabase
      .from('intervention_anomalies')
      .select('intervention_id')
      .in('intervention_id', knownIntvIds)
      .eq('status', 'open')
    for (const a of (anomalyRows ?? []) as Array<{ intervention_id: string }>) {
      const mId = interventionToMission.get(a.intervention_id)
      if (mId) anomalyCountByMission.set(mId, (anomalyCountByMission.get(mId) ?? 0) + 1)
    }
  }

  // 6. Assemblage final
  const result: MissionCockpitRow[] = missions.map((m) => {
    const site = siteById.get(m.site_id)
    return {
      id: m.id,
      name: m.name,
      cadence: m.cadence,
      active: m.active,
      siteId: m.site_id,
      siteName: site?.name ?? '—',
      contractId: site?.contractId ?? null,
      contractName: site?.contractName ?? null,
      assignedTeam: m.assigned_team_id ? (teamById.get(m.assigned_team_id) ?? null) : null,
      lastInterventionDate: lastByMission.get(m.id) ?? null,
      nextInterventionDate: nextByMission.get(m.id) ?? null,
      openAnomalyCount: anomalyCountByMission.get(m.id) ?? 0,
    }
  })

  const active = result.filter((m) => m.active)
  const stats: MissionCockpitStats = {
    total: active.length,
    withoutNextIntervention: active.filter((m) => !m.nextInterventionDate).length,
    withoutTeam: active.filter((m) => !m.assignedTeam).length,
    withAnomalies: result.filter((m) => m.openAnomalyCount > 0).length,
  }

  return { missions: result, stats }
}
