import 'server-only'

// Les options du menu « Planifier » — missions, chantiers, équipes, rythmes.
//
// Extraites de semaine/page.tsx pour que la vue MOIS offre le même geste :
// créer une intervention ou un roulement sans repasser par la semaine. Une
// seule source pour les deux échelles — jamais deux assembleurs d'options.

import { createAdminClient } from '@/lib/supabase/admin'
import { isSystemMissionName } from '@/lib/db/system-missions'
import { countFieldMembersByTeam } from '@/lib/db/team-field-members'
import { describeTemplate } from '@/lib/recurrence/describe'
import type { DbInterventionTemplate } from '@/types/db'
import type { MissionOption, SiteOption } from './CreateInterventionDialog'
import type { RotationOption } from './planning-prefill'

/** Liste toutes les missions actives (non archivées) avec site + contrat pour le
 * picker du dialogue de planification. Requête admin (manager+ déjà vérifié plus
 * haut) — P1 isolation : FAIL-CLOSED sur l'organisation, comme
 * listInterventionsForWeek (jamais les missions de tous les tenants). */
export async function fetchMissionOptions(orgIds: string[]): Promise<MissionOption[]> {
  if (orgIds.length === 0) return []
  const supabase = createAdminClient()
  // Contrat en LEFT join (PR 2) : un chantier créé sans contrat (cas réel
  // « Pointière Discount », contract_id nullable dans CreateSiteDialog) doit
  // quand même exposer ses missions au planificateur. L'ancien `!inner` les
  // rendait invisibles — LE « ma mission n'apparaît pas » résiduel.
  const { data, error } = await supabase
    .from('missions')
    .select(
      `id, name, assigned_team_id,
       site:sites!inner(id, name, deleted_at, client:clients(name), contract:contracts(name, deleted_at))`,
    )
    .is('deleted_at', null)
    .eq('active', true)
    .in('organization_id', orgIds)
  if (error) throw error
  type Named = { name: string }
  const out: MissionOption[] = []
  for (const m of (data ?? []) as Array<{
    id: string
    name: string
    assigned_team_id: string | null
    site:
      | { id: string; name: string; deleted_at: string | null; client: Named | Named[] | null; contract: { name: string; deleted_at: string | null } | { name: string; deleted_at: string | null }[] | null }
      | Array<{ id: string; name: string; deleted_at: string | null; client: Named | Named[] | null; contract: { name: string; deleted_at: string | null } | { name: string; deleted_at: string | null }[] | null }>
  }>) {
    // V5.1 — Exclure les missions système ("Traces libres du site") du picker
    // de planification. Cf. lib/db/system-missions.ts.
    if (isSystemMissionName(m.name)) continue
    const site = Array.isArray(m.site) ? m.site[0] : m.site
    if (!site || site.deleted_at) continue
    const client = Array.isArray(site.client) ? site.client[0] : site.client
    const contract = Array.isArray(site.contract) ? site.contract[0] : site.contract
    // Contrat soft-deleted → on le tait, mais la mission reste planifiable.
    out.push({
      id: m.id,
      name: m.name,
      siteId: site.id,
      siteName: site.name,
      clientName: client?.name ?? null,
      contractName: contract && !contract.deleted_at ? contract.name : '—',
      defaultTeamId: m.assigned_team_id,
    })
  }
  return out
}

/** Chantiers de l'org pour la création INLINE de mission dans le planificateur
 * (PR 2, lot Y « créer → rester → sélectionné »). Fail-closed org. */
export async function fetchSiteOptions(orgIds: string[]): Promise<SiteOption[]> {
  if (orgIds.length === 0) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .select('id, name, client:clients(name), contract:contracts(name, deleted_at)')
    .is('deleted_at', null)
    .in('organization_id', orgIds)
    .order('name')
  if (error) throw error
  type Named = { name: string }
  return ((data ?? []) as Array<{
    id: string
    name: string
    client: Named | Named[] | null
    contract: { name: string; deleted_at: string | null } | { name: string; deleted_at: string | null }[] | null
  }>).map((s) => {
    const client = Array.isArray(s.client) ? s.client[0] : s.client
    const contract = Array.isArray(s.contract) ? s.contract[0] : s.contract
    return {
      id: s.id,
      name: s.name,
      clientName: client?.name ?? null,
      contractName: contract && !contract.deleted_at ? contract.name : null,
    }
  })
}

/** Compte les personnes actives par équipe : membres CONNECTÉS (team_members)
 * + personnes TERRAIN sans compte (team_field_members, mig 219). Le compteur du
 * planificateur additionne les deux — la distinction se lit dans la composition,
 * page Équipes. Info descriptive, doctrine V2 : JAMAIS exploité comme KPI.
 * P1 isolation : fail-closed org. */
export async function fetchTeamMemberCounts(orgIds: string[]): Promise<Map<string, number>> {
  if (orgIds.length === 0) return new Map()
  const supabase = createAdminClient()
  const [{ data, error }, fieldCounts] = await Promise.all([
    supabase
      .from('team_members')
      .select('team_id')
      .is('left_at', null)
      .in('organization_id', orgIds),
    countFieldMembersByTeam(orgIds),
  ])
  if (error) throw error
  const counts = new Map<string, number>(fieldCounts)
  for (const row of data ?? []) {
    counts.set(row.team_id, (counts.get(row.team_id) ?? 0) + 1)
  }
  return counts
}

export async function fetchRotationOptions(missions: MissionOption[]): Promise<RotationOption[]> {
  if (missions.length === 0) return []
  const missionById = new Map(missions.map((m) => [m.id, m]))
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_templates')
    .select('*')
    .in('mission_id', missions.map((m) => m.id))
    .eq('active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error

  return ((data ?? []) as DbInterventionTemplate[]).flatMap((template) => {
    const mission = missionById.get(template.mission_id)
    if (!mission) return []
    return [{
      id: template.id,
      missionId: mission.id,
      missionName: mission.name,
      siteId: mission.siteId,
      title: template.title,
      label: describeTemplate(template),
      endsOn: template.ends_on ?? null,
    }]
  })
}
