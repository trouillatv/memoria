// Slice M2 — Briefing du soir (Doctrine V5 Pilier 3)
//
// « Jouer la PRÉPARATION où MemorIA gagne, pas la RÉSOLUTION où WhatsApp gagne. »
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
import { todayLocalIso, tomorrowLocalIso, addDaysLocal } from '@/lib/time/local-date'

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
  /** Sites avec multiple interventions ce jour (signal positif coverage).
   *  `teams` = équipes affectées avec couleur + composition (membres + référent),
   *  pour afficher un popover esthétique au hover/click.
   *  `recentNotes` = jusqu'à 5 dernières notes mémoire des lieux (site_notes).
   *  `fields` = champs structurés "fiche site" (code entrée, contact, etc.). */
  coverageBySite: Array<{
    site_name: string
    count: number
    teams: Array<{
      id: string
      name: string
      color: string | null
      memberNames: string[]
      referentName: string | null
    }>
    /** Slots distincts (morning/afternoon/evening) ordonnés. Utilisé par
     *  le texte de partage WhatsApp pour qualifier chaque ligne. */
    slots: string[]
    recentNotes: Array<{ body: string; created_at: string }>
    fields: {
      address: string | null
      access_code: string | null
      alarm_code: string | null
      contact_name: string | null
      contact_phone: string | null
      access_hours: string | null
      access_instructions: string | null
    }
  }>
  /** Contrats dont la date de fin tombe dans les 60 prochains jours.
   *  Signal proactif renouvellement, jamais un score de risque. Tri end_date asc. */
  contractsExpiringSoon: Array<{
    id: string
    name: string
    client_name: string
    end_date: string
    daysUntilEnd: number
  }>
}

export async function buildEveningBriefing(targetDate: string): Promise<EveningBriefing> {
  const supabase = createAdminClient()

  // 1) Interventions prévues à la date cible (status planned ou in_progress)
  const { data: rows, error } = await supabase
    .from('interventions')
    .select(
      `id, slot, assigned_team_id,
       team:teams(id, name, color),
       mission:missions!inner(name, site:sites!inner(id, name, contract:contracts(name)))`,
    )
    .eq('scheduled_for', targetDate)
    .in('status', ['planned', 'in_progress'])
  if (error) throw error

  type TeamLite = { id: string; name: string; color: string | null }
  type Row = {
    id: string
    slot: string | null
    assigned_team_id: string | null
    team: TeamLite | TeamLite[] | null
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

  // 3) Sites couverts. On stocke les équipes par ID unique (dedup) avec
  // couleur, nom. La composition (membres + référent) est ajoutée à la fin
  // après une requête batch sur team_members + users.
  const siteCoverage = new Map<
    string,
    { name: string; count: number; teams: Map<string, TeamLite>; slots: Set<string> }
  >()
  const unassigned: EveningBriefing['unassignedInterventions'] = []

  for (const r of interventions) {
    const mission = pickOne(r.mission)
    if (!mission) continue
    const site = pickOne(mission.site)
    if (!site) continue
    const team = pickOne(r.team)
    const entry =
      siteCoverage.get(site.id) ??
      { name: site.name, count: 0, teams: new Map<string, TeamLite>(), slots: new Set<string>() }
    entry.count += 1
    if (team?.id && !entry.teams.has(team.id)) {
      entry.teams.set(team.id, { id: team.id, name: team.name, color: team.color ?? null })
    }
    if (r.slot) entry.slots.add(r.slot)
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

  // 3.b) Composition des équipes couvertes : membres actifs + référent.
  // Pour éviter N+1, on batch sur tous les team_ids vus.
  const allTeamIds = Array.from(
    new Set(
      Array.from(siteCoverage.values()).flatMap((s) => Array.from(s.teams.keys())),
    ),
  )
  const teamComposition = new Map<
    string,
    { memberNames: string[]; referentName: string | null }
  >()
  if (allTeamIds.length > 0) {
    const [{ data: members }, { data: teamRows }] = await Promise.all([
      supabase
        .from('team_members')
        .select('team_id, user:users(full_name, email)')
        .in('team_id', allTeamIds)
        .is('left_at', null),
      supabase
        .from('teams')
        .select('id, referent:users!teams_referent_user_id_fkey(full_name, email)')
        .in('id', allTeamIds),
    ])
    type UserLite = { full_name: string | null; email: string }
    const displayName = (u: UserLite | null | undefined): string =>
      (u?.full_name ?? '').trim() || (u?.email.split('@')[0] ?? '?')

    for (const m of (members ?? []) as Array<{
      team_id: string
      user: UserLite | UserLite[] | null
    }>) {
      const u = pickOne(m.user)
      if (!u) continue
      const c = teamComposition.get(m.team_id) ?? { memberNames: [], referentName: null }
      c.memberNames.push(displayName(u))
      teamComposition.set(m.team_id, c)
    }
    for (const t of (teamRows ?? []) as Array<{
      id: string
      referent: UserLite | UserLite[] | null
    }>) {
      const ref = pickOne(t.referent)
      if (!ref) continue
      const c = teamComposition.get(t.id) ?? { memberNames: [], referentName: null }
      c.referentName = displayName(ref)
      teamComposition.set(t.id, c)
    }
    // Tri alpha des membres pour chaque équipe
    for (const c of teamComposition.values()) {
      c.memberNames.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
    }
  }

  // 4) Sites du tenant sans couverture demain
  //    On prend les sites avec ≥1 contrat actif et qui ne sont PAS dans siteCoverage.
  const { data: allActiveSites } = await supabase
    .from('sites')
    .select('id, name, contract:contracts(id, name, end_date)')
    .is('deleted_at', null)
  const sitesWithoutCoverage: EveningBriefing['sitesWithoutCoverage'] = []
  const today = todayLocalIso()
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

  // 5.a) Mémoire des lieux — 5 dernières site_notes actives par site couvert
  // + champs structurés (code entrée, contact, etc.) en 2 requêtes batch.
  const coveredSiteIds = Array.from(siteCoverage.keys())
  const notesBySiteId = new Map<string, Array<{ body: string; created_at: string }>>()
  type SiteFieldsRow = {
    id: string
    address: string | null
    access_code: string | null
    alarm_code: string | null
    contact_name: string | null
    contact_phone: string | null
    access_hours: string | null
    access_instructions: string | null
  }
  const fieldsBySiteId = new Map<string, Omit<SiteFieldsRow, 'id'>>()
  if (coveredSiteIds.length > 0) {
    const [notesRes, fieldsRes] = await Promise.all([
      supabase
        .from('site_notes')
        .select('site_id, body, created_at')
        .in('site_id', coveredSiteIds)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('sites')
        .select(
          'id, address, access_code, alarm_code, contact_name, contact_phone, access_hours, access_instructions',
        )
        .in('id', coveredSiteIds),
    ])
    for (const n of (notesRes.data ?? []) as Array<{
      site_id: string
      body: string
      created_at: string
    }>) {
      const arr = notesBySiteId.get(n.site_id) ?? []
      if (arr.length < 5) {
        arr.push({ body: n.body, created_at: n.created_at })
        notesBySiteId.set(n.site_id, arr)
      }
    }
    for (const f of (fieldsRes.data ?? []) as SiteFieldsRow[]) {
      const { id, ...rest } = f
      fieldsBySiteId.set(id, rest)
    }
  }

  // 5.b) Coverage by site (positif — pour affichage rassurant). Enrichi avec
  // membres + référent pour le popover et notes récentes pour la mémoire.
  const coverageBySite = Array.from(siteCoverage.entries())
    .map(([siteId, c]) => ({
      site_name: c.name,
      count: c.count,
      teams: Array.from(c.teams.values())
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
        .map((t) => {
          const comp = teamComposition.get(t.id)
          return {
            id: t.id,
            name: t.name,
            color: t.color,
            memberNames: comp?.memberNames ?? [],
            referentName: comp?.referentName ?? null,
          }
        }),
      slots: ['morning', 'afternoon', 'evening'].filter((s) => c.slots.has(s)),
      recentNotes: notesBySiteId.get(siteId) ?? [],
      fields: fieldsBySiteId.get(siteId) ?? {
        address: null,
        access_code: null,
        alarm_code: null,
        contact_name: null,
        contact_phone: null,
        access_hours: null,
        access_instructions: null,
      },
    }))
    .sort((a, b) => a.site_name.localeCompare(b.site_name, 'fr', { sensitivity: 'base' }))

  // 6) Contrats expirants — fenêtre 60 jours, signal renouvellement.
  const todayShort = todayLocalIso()
  const horizonIso = addDaysLocal(todayShort, 60)
  const { data: expiringRows } = await supabase
    .from('contracts')
    .select('id, name, client_name, end_date, status')
    .gte('end_date', todayShort)
    .lte('end_date', horizonIso)
    .in('status', ['active', 'paused'])
    .order('end_date', { ascending: true })
  const contractsExpiringSoon = ((expiringRows ?? []) as Array<{
    id: string
    name: string
    client_name: string
    end_date: string
  }>).map((c) => {
    const days = Math.max(
      0,
      Math.round(
        (new Date(c.end_date + 'T00:00:00Z').getTime() -
          new Date(todayShort + 'T00:00:00Z').getTime()) /
          (24 * 3600 * 1000),
      ),
    )
    return {
      id: c.id,
      name: c.name,
      client_name: c.client_name,
      end_date: c.end_date,
      daysUntilEnd: days,
    }
  })

  return {
    date: targetDate,
    interventionsCount,
    teamsCount,
    sitesWithoutCoverage: sitesWithoutCoverage.sort((a, b) =>
      a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
    ),
    unassignedInterventions: unassigned,
    coverageBySite,
    contractsExpiringSoon,
  }
}

/** Date "demain" en zone Nouméa, yyyy-mm-dd. Doctrine : "demain" doit être
 *  la date civile de demain locale, pas la date UTC. Le nom historique
 *  `tomorrowUtcIso` est conservé pour compat appel (peu d'appelants). */
export function tomorrowUtcIso(): string {
  return tomorrowLocalIso()
}
