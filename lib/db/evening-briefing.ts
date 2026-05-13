// Slice M2 — Briefing du soir (Doctrine V5 Pilier 3)
//
// « Jouer la PRÉPARATION où NetoIAge gagne, pas la RÉSOLUTION où WhatsApp gagne. »
//
// Helper qui calcule, pour une date donnée (typiquement demain), les chiffres
// clés que Maeva veut voir avant de se coucher :
//
//   - N interventions prévues
//   - N équipes mobilisées
//   - N sites sans couverture (= sites avec un contrat actif mais 0 intervention demain)
//   - Points de vigilance : interventions sans équipe affectée, intervention répétée raté
//
// Doctrine V5 :
//   - AGRÉGATS uniquement. JAMAIS de nom d'agent.
//   - "Sans couverture" = signal logistique normal, jamais une alarme.
//   - Pas de score qualité, pas de classement.

import { createAdminClient } from '@/lib/supabase/admin'

export interface EveningBriefing {
  /** Date du lendemain ciblé (yyyy-mm-dd). */
  date: string
  /** Nombre total d'interventions prévues. */
  interventionsCount: number
  /** Nombre d'équipes mobilisées (distinct assigned_team_id non null). */
  teamsCount: number
  /** Sites du tenant sans aucune intervention prévue ce jour-là. */
  sitesWithoutCoverage: Array<{ id: string; name: string; contract_name: string | null }>
  /** Interventions sans équipe affectée (assigned_team_id null). */
  unassignedInterventions: Array<{
    id: string
    mission_name: string
    site_name: string
    slot: string | null
  }>
  /** Sites avec multiple interventions ce jour (signal positif coverage). */
  coverageBySite: Array<{ site_name: string; count: number; team_names: string[] }>
}

export async function buildEveningBriefing(targetDate: string): Promise<EveningBriefing> {
  const supabase = createAdminClient()

  // 1) Interventions prévues à la date cible (status planned ou in_progress)
  const { data: rows, error } = await supabase
    .from('interventions')
    .select(
      `id, slot, assigned_team_id,
       team:teams(name),
       mission:missions!inner(name, site:sites!inner(id, name, contract:contracts(name)))`,
    )
    .eq('scheduled_for', targetDate)
    .in('status', ['planned', 'in_progress'])
  if (error) throw error

  type Row = {
    id: string
    slot: string | null
    assigned_team_id: string | null
    team: { name: string } | { name: string }[] | null
    mission: {
      name: string
      site:
        | { id: string; name: string; contract: { name: string } | { name: string }[] | null }
        | Array<{ id: string; name: string; contract: { name: string } | { name: string }[] | null }>
    } | Array<{
      name: string
      site:
        | { id: string; name: string; contract: { name: string } | { name: string }[] | null }
        | Array<{ id: string; name: string; contract: { name: string } | { name: string }[] | null }>
    }>
  }

  const pickOne = <T>(v: T | T[] | null): T | null => {
    if (v === null) return null
    return Array.isArray(v) ? v[0] ?? null : v
  }

  const interventions = (rows ?? []) as Row[]
  const interventionsCount = interventions.length

  // 2) Équipes mobilisées (distinct team ids non null)
  const teamIds = new Set<string>()
  for (const r of interventions) {
    if (r.assigned_team_id) teamIds.add(r.assigned_team_id)
  }
  const teamsCount = teamIds.size

  // 3) Sites couverts
  const siteCoverage = new Map<string, { name: string; count: number; teams: Set<string> }>()
  const unassigned: EveningBriefing['unassignedInterventions'] = []

  for (const r of interventions) {
    const mission = pickOne(r.mission)
    if (!mission) continue
    const site = pickOne(mission.site)
    if (!site) continue
    const team = pickOne(r.team)
    const entry = siteCoverage.get(site.id) ?? { name: site.name, count: 0, teams: new Set<string>() }
    entry.count += 1
    if (team?.name) entry.teams.add(team.name)
    siteCoverage.set(site.id, entry)

    if (!r.assigned_team_id) {
      unassigned.push({
        id: r.id,
        mission_name: mission.name,
        site_name: site.name,
        slot: r.slot,
      })
    }
  }

  // 4) Sites du tenant sans couverture demain
  //    On prend les sites avec ≥1 contrat actif et qui ne sont PAS dans siteCoverage.
  const { data: allActiveSites } = await supabase
    .from('sites')
    .select('id, name, contract:contracts(id, name, end_date)')
    .is('deleted_at', null)
  const sitesWithoutCoverage: EveningBriefing['sitesWithoutCoverage'] = []
  const today = new Date().toISOString().slice(0, 10)
  for (const s of (allActiveSites ?? []) as Array<{
    id: string
    name: string
    contract: { name: string; end_date: string | null } | { name: string; end_date: string | null }[] | null
  }>) {
    if (siteCoverage.has(s.id)) continue
    const contract = pickOne(s.contract)
    // Ignore les sites dont le contrat est expiré
    if (contract?.end_date && contract.end_date < today) continue
    sitesWithoutCoverage.push({
      id: s.id,
      name: s.name,
      contract_name: contract?.name ?? null,
    })
  }

  // 5) Coverage by site (positif — pour affichage rassurant)
  const coverageBySite = Array.from(siteCoverage.values())
    .map((c) => ({
      site_name: c.name,
      count: c.count,
      team_names: Array.from(c.teams).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })),
    }))
    .sort((a, b) => a.site_name.localeCompare(b.site_name, 'fr', { sensitivity: 'base' }))

  return {
    date: targetDate,
    interventionsCount,
    teamsCount,
    sitesWithoutCoverage: sitesWithoutCoverage.sort((a, b) =>
      a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
    ),
    unassignedInterventions: unassigned,
    coverageBySite,
  }
}

/** Date "demain" en UTC yyyy-mm-dd. */
export function tomorrowUtcIso(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
