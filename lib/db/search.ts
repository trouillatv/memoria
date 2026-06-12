// Moteur de recherche cross-site.
//
// Cherche en parallèle dans 4 sources : notes terrain, noms de missions,
// descriptions d'anomalies, noms d'entreprises externes. Retourne les
// interventions correspondantes enrichies (site, équipe, compteurs, entreprises).
//
// Usage typique : Adrien tape "porte 42" → intervention + site + date + intervenants.

import { createAdminClient } from '@/lib/supabase/admin'

export type MatchSource = 'notes' | 'mission' | 'anomaly' | 'company'

export interface SearchHit {
  interventionId: string
  missionName: string
  siteId: string
  siteName: string
  status: string
  notes: string | null
  date: string // YYYY-MM-DD (Pacific/Noumea)
  teamName: string | null
  teamColor: string | null
  participantCount: number
  photoCount: number
  openAnomalies: number
  companies: Array<{ company_name: string; role_description: string | null }>
  matchSources: MatchSource[]
}

function toLocalDate(iso: string): string {
  const d = new Date(iso)
  const [day, month, year] = d
    .toLocaleDateString('fr-FR', {
      timeZone: 'Pacific/Noumea',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    .split('/')
  return `${year}-${month}-${day}`
}

export async function searchInterventions(
  rawQuery: string,
  orgId: string,
  options?: { limit?: number },
): Promise<SearchHit[]> {
  const q = rawQuery.trim()
  if (q.length < 2) return []
  const term = `%${q}%`
  const limit = options?.limit ?? 40
  const sb = createAdminClient()

  // ── Phase 1 : IDs d'interventions depuis 4 sources (parallèle) ──────────────

  const [noteIds, missionInterventionIds, anomalyInterventionIds, companyInterventionIds] =
    await Promise.all([
      // Source 1 : notes de l'intervention
      sb
        .from('interventions')
        .select('id')
        .eq('organization_id', orgId)
        .neq('status', 'planned')
        .is('deleted_at', null)
        .ilike('notes', term)
        .limit(limit)
        .then((r) => (r.data ?? []).map((x) => x.id as string)),

      // Source 2 : nom de mission
      sb
        .from('missions')
        .select('id')
        .ilike('name', term)
        .is('deleted_at', null)
        .limit(50)
        .then(async (r) => {
          const mIds = (r.data ?? []).map((x) => x.id as string)
          if (mIds.length === 0) return [] as string[]
          const r2 = await sb
            .from('interventions')
            .select('id')
            .eq('organization_id', orgId)
            .neq('status', 'planned')
            .is('deleted_at', null)
            .in('mission_id', mIds)
            .limit(limit)
          return (r2.data ?? []).map((x) => x.id as string)
        }),

      // Source 3 : description d'anomalie
      sb
        .from('intervention_anomalies')
        .select('intervention_id')
        .ilike('description', term)
        .limit(50)
        .then(async (r) => {
          const ids = [...new Set((r.data ?? []).map((x) => x.intervention_id as string))]
          if (ids.length === 0) return [] as string[]
          const r2 = await sb
            .from('interventions')
            .select('id')
            .eq('organization_id', orgId)
            .neq('status', 'planned')
            .is('deleted_at', null)
            .in('id', ids)
          return (r2.data ?? []).map((x) => x.id as string)
        }),

      // Source 4 : nom d'entreprise externe
      (async (): Promise<string[]> => {
        try {
          const r = await sb
            .from('intervention_companies')
            .select('intervention_id')
            .ilike('company_name', term)
            .limit(50)
          if (r.error) return []
          const ids = [...new Set((r.data ?? []).map((x) => x.intervention_id as string))]
          if (ids.length === 0) return []
          const r2 = await sb
            .from('interventions')
            .select('id')
            .eq('organization_id', orgId)
            .neq('status', 'planned')
            .is('deleted_at', null)
            .in('id', ids)
          return (r2.data ?? []).map((x) => x.id as string)
        } catch {
          return []
        }
      })(),
    ])

  // Union + suivi des sources
  const idToSources = new Map<string, Set<MatchSource>>()
  const addIds = (ids: string[], src: MatchSource) => {
    for (const id of ids) {
      if (!idToSources.has(id)) idToSources.set(id, new Set())
      idToSources.get(id)!.add(src)
    }
  }
  addIds(noteIds, 'notes')
  addIds(missionInterventionIds, 'mission')
  addIds(anomalyInterventionIds, 'anomaly')
  addIds(companyInterventionIds, 'company')

  const allIds = [...idToSources.keys()].slice(0, limit)
  if (allIds.length === 0) return []

  // ── Phase 2 : données complètes pour ces interventions ─────────────────────

  type IntRow = {
    id: string
    mission_id: string
    status: string
    scheduled_at: string
    executed_at: string | null
    notes: string | null
    assigned_team_id: string | null
  }

  const { data: intData, error: intErr } = await sb
    .from('interventions')
    .select('id, mission_id, status, scheduled_at, executed_at, notes, assigned_team_id')
    .in('id', allIds)
  if (intErr) throw intErr
  const ints = (intData ?? []) as IntRow[]
  if (ints.length === 0) return []

  const uniqueMissionIds = [...new Set(ints.map((i) => i.mission_id))]
  const uniqueTeamIds = [
    ...new Set(ints.map((i) => i.assigned_team_id).filter((id): id is string => id !== null)),
  ]

  // ── Phase 3 : missions + équipes (parallèle) ────────────────────────────────

  const [missionsData, teamsData] = await Promise.all([
    sb
      .from('missions')
      .select('id, name, site_id')
      .in('id', uniqueMissionIds)
      .then((r) => (r.data ?? []) as Array<{ id: string; name: string; site_id: string }>),
    uniqueTeamIds.length > 0
      ? sb
          .from('teams')
          .select('id, name, color')
          .in('id', uniqueTeamIds)
          .then((r) => (r.data ?? []) as Array<{ id: string; name: string; color: string | null }>)
      : Promise.resolve([] as Array<{ id: string; name: string; color: string | null }>),
  ])

  const missionById = new Map<string, { name: string; site_id: string }>()
  for (const m of missionsData) missionById.set(m.id, { name: m.name, site_id: m.site_id })

  const teamById = new Map<string, { name: string; color: string | null }>()
  for (const t of teamsData) teamById.set(t.id, { name: t.name, color: t.color })

  // ── Phase 4 : sites ──────────────────────────────────────────────────────────

  const uniqueSiteIds = [
    ...new Set(missionsData.map((m) => m.site_id).filter(Boolean)),
  ]
  const { data: sitesData } = await sb
    .from('sites')
    .select('id, name')
    .in('id', uniqueSiteIds)
    .is('deleted_at', null)
  const siteById = new Map<string, string>()
  for (const s of (sitesData ?? []) as Array<{ id: string; name: string }>) {
    siteById.set(s.id, s.name)
  }

  // ── Phase 5 : compteurs + entreprises (parallèle) ────────────────────────────

  type CountRow = { intervention_id: string }
  type AnomalyRow = { intervention_id: string; status: string }
  type CompanyRow = { intervention_id: string; company_name: string; role_description: string | null }

  const [participantsData, photosData, anomaliesData, companiesData] = await Promise.all([
    sb
      .from('intervention_participants')
      .select('intervention_id')
      .in('intervention_id', allIds)
      .then((r) => (r.data ?? []) as CountRow[]),
    sb
      .from('intervention_photos')
      .select('intervention_id')
      .in('intervention_id', allIds)
      .then((r) => (r.data ?? []) as CountRow[]),
    sb
      .from('intervention_anomalies')
      .select('intervention_id, status')
      .in('intervention_id', allIds)
      .then((r) => (r.data ?? []) as AnomalyRow[]),
    (async (): Promise<CompanyRow[]> => {
      try {
        const r = await sb
          .from('intervention_companies')
          .select('intervention_id, company_name, role_description')
          .in('intervention_id', allIds)
        return (r.data ?? []) as CompanyRow[]
      } catch {
        return []
      }
    })(),
  ])

  const participantCount = new Map<string, number>()
  for (const r of participantsData) {
    participantCount.set(r.intervention_id, (participantCount.get(r.intervention_id) ?? 0) + 1)
  }
  const photoCount = new Map<string, number>()
  for (const r of photosData) {
    photoCount.set(r.intervention_id, (photoCount.get(r.intervention_id) ?? 0) + 1)
  }
  const openAnomalies = new Map<string, number>()
  for (const r of anomaliesData) {
    if (r.status !== 'resolved') {
      openAnomalies.set(r.intervention_id, (openAnomalies.get(r.intervention_id) ?? 0) + 1)
    }
  }
  const companiesByIntervention = new Map<
    string,
    Array<{ company_name: string; role_description: string | null }>
  >()
  for (const r of companiesData) {
    const arr = companiesByIntervention.get(r.intervention_id) ?? []
    arr.push({ company_name: r.company_name, role_description: r.role_description })
    companiesByIntervention.set(r.intervention_id, arr)
  }

  // ── Phase 6 : assemblage ─────────────────────────────────────────────────────

  return ints
    .map((i) => {
      const mission = missionById.get(i.mission_id)
      if (!mission) return null
      const siteName = siteById.get(mission.site_id) ?? '—'
      const team = i.assigned_team_id ? teamById.get(i.assigned_team_id) : undefined
      return {
        interventionId: i.id,
        missionName: mission.name,
        siteId: mission.site_id,
        siteName,
        status: i.status,
        notes: i.notes,
        date: toLocalDate(i.executed_at ?? i.scheduled_at),
        teamName: team?.name ?? null,
        teamColor: team?.color ?? null,
        participantCount: participantCount.get(i.id) ?? 0,
        photoCount: photoCount.get(i.id) ?? 0,
        openAnomalies: openAnomalies.get(i.id) ?? 0,
        companies: companiesByIntervention.get(i.id) ?? [],
        matchSources: [...(idToSources.get(i.id) ?? [])] as MatchSource[],
      } satisfies SearchHit
    })
    .filter((h): h is SearchHit => h !== null)
    .sort((a, b) => b.date.localeCompare(a.date))
}
