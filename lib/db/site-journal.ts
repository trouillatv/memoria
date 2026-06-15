// Journal du chantier — vue chronologique exhaustive d'un site.
//
// Contrairement au TraceStream / Mémoire du lieu (getSiteMemoryTimeline),
// le Journal montre TOUTES les interventions qui ont eu lieu ou ont été
// sautées — pas seulement celles avec des notes. C'est l'historique brut,
// centré sur "qui était là, quand, avec combien de photos et d'anomalies".
//
// Doctrine : lecture pure, aucun tri éditorial. La routine a sa place ici.

import { createAdminClient } from '@/lib/supabase/admin'

// ----------------------------------------------------------------------------
// Types publics
// ----------------------------------------------------------------------------

export interface JournalEntry {
  date: string // yyyy-mm-dd (fuseau Pacific/Noumea)
  interventions: JournalIntervention[]
  // Météo / intempérie du jour (site_day_log) — attachée par
  // mergeWeatherIntoJournal. Optionnel : absent si aucune entrée météo.
  weather?: import('@/lib/db/site-day-log').WeatherCode | null
  intemperie?: boolean
  weatherNote?: string | null
}

export interface JournalIntervention {
  id: string
  missionName: string
  status: string
  executedAt: string | null
  scheduledAt: string
  notes: string | null
  teamName: string | null
  teamColor: string | null
  participantCount: number
  photoCount: number
  anomaliesOpen: number
  anomaliesResolved: number
  // Entreprises présentes (intervention_companies). Vide si table absente.
  companies: Array<{
    id: string
    company_name: string
    role_description: string | null
  }>
}

// ----------------------------------------------------------------------------
// Helper — conversion ISO → date locale Pacific/Noumea
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// getSiteJournal
// ----------------------------------------------------------------------------

export async function getSiteJournal(
  siteId: string,
  options?: { limit?: number; dateFrom?: string },
): Promise<JournalEntry[]> {
  const sb = createAdminClient()
  const limit = options?.limit ?? 300

  // 1. Missions du site (non supprimées)
  const { data: missions, error: missionsErr } = await sb
    .from('missions')
    .select('id, name')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  if (missionsErr) throw missionsErr

  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) return []

  const missionNameById = new Map<string, string>(
    (missions ?? []).map((m) => [m.id, m.name as string]),
  )

  // 2. Toutes les interventions qui ont eu lieu ou ont été sautées
  //    (status != 'planned' — on exclut ce qui ne s'est pas encore passé)
  type InterventionRow = {
    id: string
    mission_id: string
    status: string
    scheduled_at: string
    executed_at: string | null
    notes: string | null
    assigned_team_id: string | null
  }

  let q = sb
    .from('interventions')
    .select('id, mission_id, status, scheduled_at, executed_at, notes, assigned_team_id')
    .in('mission_id', missionIds)
    .neq('status', 'planned')
    .order('executed_at', { ascending: false, nullsFirst: false })
    .order('scheduled_at', { ascending: false })

  if (options?.dateFrom) {
    q = q.gte('scheduled_at', options.dateFrom)
  }

  const { data: interventionsData, error: interventionsErr } = await q
  if (interventionsErr) throw interventionsErr

  const interventions = (interventionsData ?? []) as InterventionRow[]
  if (interventions.length === 0) return []

  const interventionIds = interventions.map((i) => i.id)

  // 3. Résolution batch des équipes
  const teamIdSet = new Set<string>()
  for (const i of interventions) {
    if (i.assigned_team_id) teamIdSet.add(i.assigned_team_id)
  }

  const teamById = new Map<string, { name: string; color: string | null }>()
  if (teamIdSet.size > 0) {
    const { data: teamsData, error: teamsErr } = await sb
      .from('teams')
      .select('id, name, color')
      .in('id', [...teamIdSet])
    if (teamsErr) throw teamsErr
    for (const t of (teamsData ?? []) as Array<{ id: string; name: string; color: string | null }>) {
      teamById.set(t.id, { name: t.name, color: t.color })
    }
  }

  // 4. Participants — batch, pas de N+1
  const participantCountById = new Map<string, number>()
  {
    const { data: participantRows, error: participantErr } = await sb
      .from('intervention_participants')
      .select('intervention_id')
      .in('intervention_id', interventionIds)
    if (participantErr) throw participantErr
    for (const row of (participantRows ?? []) as Array<{ intervention_id: string }>) {
      participantCountById.set(
        row.intervention_id,
        (participantCountById.get(row.intervention_id) ?? 0) + 1,
      )
    }
  }

  // 5. Photos — batch
  const photoCountById = new Map<string, number>()
  {
    const { data: photoRows, error: photoErr } = await sb
      .from('intervention_photos')
      .select('intervention_id')
      .in('intervention_id', interventionIds)
    if (photoErr) throw photoErr
    for (const row of (photoRows ?? []) as Array<{ intervention_id: string }>) {
      photoCountById.set(
        row.intervention_id,
        (photoCountById.get(row.intervention_id) ?? 0) + 1,
      )
    }
  }

  // 6. Anomalies — batch (open / resolved)
  const anomaliesOpenById = new Map<string, number>()
  const anomaliesResolvedById = new Map<string, number>()
  {
    const { data: anomalyRows, error: anomalyErr } = await sb
      .from('intervention_anomalies')
      .select('intervention_id, status')
      .in('intervention_id', interventionIds)
    if (anomalyErr) throw anomalyErr
    for (const row of (anomalyRows ?? []) as Array<{ intervention_id: string; status: string }>) {
      if (row.status === 'resolved') {
        anomaliesResolvedById.set(
          row.intervention_id,
          (anomaliesResolvedById.get(row.intervention_id) ?? 0) + 1,
        )
      } else {
        anomaliesOpenById.set(
          row.intervention_id,
          (anomaliesOpenById.get(row.intervention_id) ?? 0) + 1,
        )
      }
    }
  }

  // 7. Entreprises présentes (intervention_companies) — dégradation gracieuse
  //    si la table n'existe pas encore.
  type CompanyRow = {
    intervention_id: string
    id: string
    company_name: string
    role_description: string | null
  }
  const companiesByInterventionId = new Map<
    string,
    Array<{ id: string; company_name: string; role_description: string | null }>
  >()
  try {
    const { data: companyRows, error: companyErr } = await sb
      .from('intervention_companies')
      .select('intervention_id, id, company_name, role_description')
      .in('intervention_id', interventionIds)
    if (companyErr) {
      const code = (companyErr as unknown as { code?: string }).code ?? ''
      const message = companyErr.message ?? ''
      const isTableMissing =
        code === '42P01' ||
        message.includes('does not exist') ||
        message.includes('relation') ||
        message.includes('PGRST200')
      if (!isTableMissing) throw companyErr
    } else {
      for (const row of (companyRows ?? []) as CompanyRow[]) {
        const arr = companiesByInterventionId.get(row.intervention_id) ?? []
        arr.push({
          id: row.id,
          company_name: row.company_name,
          role_description: row.role_description,
        })
        companiesByInterventionId.set(row.intervention_id, arr)
      }
    }
  } catch (err) {
    const msg = (err as Error)?.message ?? ''
    const isTableMissing =
      msg.includes('does not exist') ||
      msg.includes('relation') ||
      msg.includes('42P01')
    if (!isTableMissing) throw err
  }

  // 8. Assemblage des JournalIntervention
  const journalInterventions: JournalIntervention[] = interventions.map((i) => {
    const team = i.assigned_team_id ? teamById.get(i.assigned_team_id) : undefined
    return {
      id: i.id,
      missionName: missionNameById.get(i.mission_id) ?? '',
      status: i.status,
      executedAt: i.executed_at,
      scheduledAt: i.scheduled_at,
      notes: i.notes,
      teamName: team?.name ?? null,
      teamColor: team?.color ?? null,
      participantCount: participantCountById.get(i.id) ?? 0,
      photoCount: photoCountById.get(i.id) ?? 0,
      anomaliesOpen: anomaliesOpenById.get(i.id) ?? 0,
      anomaliesResolved: anomaliesResolvedById.get(i.id) ?? 0,
      companies: companiesByInterventionId.get(i.id) ?? [],
    }
  })

  // 9. Regroupement par date locale (Pacific/Noumea)
  const entriesByDate = new Map<string, JournalIntervention[]>()
  for (const ji of journalInterventions) {
    const dateKey = toLocalDate(ji.executedAt ?? ji.scheduledAt)
    const arr = entriesByDate.get(dateKey) ?? []
    arr.push(ji)
    entriesByDate.set(dateKey, arr)
  }

  // 10. Tri des jours décroissant + cap au limit (en nombre d'interventions total)
  const sortedDates = [...entriesByDate.keys()].sort((a, b) => (b > a ? 1 : b < a ? -1 : 0))

  const result: JournalEntry[] = []
  let totalCount = 0

  for (const date of sortedDates) {
    if (totalCount >= limit) break
    const dayInterventions = entriesByDate.get(date)!
    const capped = dayInterventions.slice(0, limit - totalCount)
    result.push({ date, interventions: capped })
    totalCount += capped.length
  }

  return result
}
