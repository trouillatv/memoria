import { createAdminClient } from '@/lib/supabase/admin'
import type {
  DbIntervention, InterventionStatus,
  DbInterventionChecklistItem, DbInterventionPhoto, PhotoKind,
  DbInterventionAnomaly, AnomalyCategory, AnomalyStatus,
  DbInterventionValidation,
} from '@/types/db'

export async function listInterventionsByMission(missionId: string): Promise<DbIntervention[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('interventions')
    .select('*')
    .eq('mission_id', missionId)
    .order('scheduled_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// ===== Supervisor list query (cross-contract) =====

export type SupervisorDateRange = 'today' | '7d' | '30d' | 'all'

export interface SupervisorInterventionsQuery {
  /** Filtre date par fenêtre prédéfinie. `all` = pas de borne basse, `today` = jour courant. */
  dateRange?: SupervisorDateRange
  /** Filtre statut intervention. */
  status?: InterventionStatus
  /** Filtre site (mission.site_id). */
  siteId?: string
  /** 0-based offset. */
  offset?: number
  /** Max items returned. */
  limit?: number
}

export interface SupervisorInterventionRow {
  id: string
  scheduled_at: string
  status: string
  mission_id: string
  skipped_reason: string | null
  mission?: {
    name: string
    site?: {
      name: string
      contract?: { id: string; name: string; client_name: string } | null
    } | null
  } | null
}

export interface SupervisorInterventionsResult {
  items: SupervisorInterventionRow[]
  total: number
}

/**
 * Liste paginée d'interventions pour la vue superviseur cross-contract.
 * Supporte les filtres date, statut, site + pagination.
 *
 * Note : pour le filtre site, on filtre côté DB via `missions.site_id`. Sans
 * possibilité native d'inner-join filter en PostgREST simple, on résout le set
 * d'ids missions d'abord.
 */
export async function listInterventionsSupervisor(
  query: SupervisorInterventionsQuery = {},
): Promise<SupervisorInterventionsResult> {
  const supabase = createAdminClient()

  // Compute date lower bound from dateRange
  const dateRange = query.dateRange ?? 'all'
  let scheduledFromIso: string | null = null
  if (dateRange === 'today') {
    const today = new Date().toISOString().split('T')[0]
    scheduledFromIso = `${today}T00:00:00`
  } else if (dateRange === '7d') {
    scheduledFromIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  } else if (dateRange === '30d') {
    scheduledFromIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  }

  // Resolve mission ids if siteId filter is present (can't filter on join in PostgREST).
  let missionIdsForSite: string[] | null = null
  if (query.siteId) {
    const { data: missions, error: mErr } = await supabase
      .from('missions')
      .select('id')
      .eq('site_id', query.siteId)
      .is('deleted_at', null)
    if (mErr) throw mErr
    missionIdsForSite = (missions ?? []).map((m) => m.id)
    if (missionIdsForSite.length === 0) {
      // No missions on this site → empty result
      return { items: [], total: 0 }
    }
  }

  let q = supabase
    .from('interventions')
    .select(
      `
      id, scheduled_at, status, mission_id, skipped_reason,
      mission:missions(id, name, site_id, site:sites(id, name, contract_id, contract:contracts(id, name, client_name)))
    `,
      { count: 'exact' },
    )
    .order('scheduled_at', { ascending: true })

  if (scheduledFromIso) q = q.gte('scheduled_at', scheduledFromIso)
  if (query.status) q = q.eq('status', query.status)
  if (missionIdsForSite) q = q.in('mission_id', missionIdsForSite)

  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.max(1, query.limit ?? 50)
  q = q.range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw error

  type RawIntervention = {
    id: string
    scheduled_at: string
    status: string
    mission_id: string
    skipped_reason: string | null
    mission?: unknown
  }

  function pickOne<T>(value: unknown): T | null {
    if (Array.isArray(value)) return (value[0] as T) ?? null
    return (value as T | null) ?? null
  }

  const raw = (data ?? []) as unknown as RawIntervention[]
  const items: SupervisorInterventionRow[] = raw.map((r) => {
    const missionRaw = pickOne<{ name: string; site?: unknown }>(r.mission)
    const siteRaw = missionRaw ? pickOne<{ name: string; contract?: unknown }>(missionRaw.site) : null
    const contractRaw = siteRaw
      ? pickOne<{ id: string; name: string; client_name: string }>(siteRaw.contract)
      : null
    return {
      id: r.id,
      scheduled_at: r.scheduled_at,
      status: r.status,
      mission_id: r.mission_id,
      skipped_reason: r.skipped_reason,
      mission: missionRaw
        ? {
            name: missionRaw.name,
            site: siteRaw ? { name: siteRaw.name, contract: contractRaw } : null,
          }
        : null,
    }
  })

  return { items, total: count ?? 0 }
}

export async function listInterventionsByContract(contractId: string): Promise<DbIntervention[]> {
  // Through sites and missions
  const supabase = createAdminClient()
  const { data: sites } = await supabase.from('sites').select('id').eq('contract_id', contractId).is('deleted_at', null)
  if (!sites?.length) return []
  const { data: missions } = await supabase.from('missions').select('id').in('site_id', sites.map((s) => s.id)).is('deleted_at', null)
  if (!missions?.length) return []
  const { data, error } = await supabase
    .from('interventions')
    .select('*')
    .in('mission_id', missions.map((m) => m.id))
    .order('scheduled_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return data ?? []
}

export async function getIntervention(id: string): Promise<DbIntervention | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('interventions').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function createIntervention(input: {
  mission_id: string
  scheduled_at: string
  team?: string[]
  created_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('interventions')
    .insert({
      mission_id: input.mission_id,
      scheduled_at: input.scheduled_at,
      team: input.team ?? [],
      status: 'planned' as InterventionStatus,
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updateInterventionStatus(
  id: string,
  status: InterventionStatus,
  executed_at?: string
): Promise<void> {
  const supabase = createAdminClient()
  const updates: Record<string, unknown> = { status }
  if (executed_at !== undefined) updates.executed_at = executed_at
  const { error } = await supabase.from('interventions').update(updates).eq('id', id)
  if (error) throw error
}

// ----- Checklist items -----
export async function listChecklistItemsByIntervention(interventionId: string): Promise<DbInterventionChecklistItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_checklist_items')
    .select('*')
    .eq('intervention_id', interventionId)
    .order('position')
  if (error) throw error
  return data ?? []
}

export async function bulkInsertChecklistItems(items: Array<{
  intervention_id: string
  engagement_id: string | null
  label: string
  position: number
  required: boolean
}>): Promise<DbInterventionChecklistItem[]> {
  if (items.length === 0) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_checklist_items')
    .insert(items.map((i) => ({ ...i, done: false })))
    .select('*')
  if (error) throw error
  return data ?? []
}

export async function markChecklistItemDone(id: string, userId: string | null): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('intervention_checklist_items')
    .update({ done: true, done_at: new Date().toISOString(), done_by: userId })
    .eq('id', id)
  if (error) throw error
}

// ----- Photos -----
export async function listPhotosByIntervention(interventionId: string): Promise<DbInterventionPhoto[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_photos')
    .select('*')
    .eq('intervention_id', interventionId)
    .order('taken_at')
  if (error) throw error
  return data ?? []
}

export async function insertPhoto(input: {
  intervention_id: string
  checklist_item_id: string | null
  storage_path: string
  kind: PhotoKind
  caption: string | null
  taken_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_photos')
    .insert(input)
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// ----- Anomalies -----
export async function listAnomaliesByIntervention(interventionId: string): Promise<DbInterventionAnomaly[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_anomalies')
    .select('*')
    .eq('intervention_id', interventionId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createAnomaly(input: {
  intervention_id: string
  engagement_id?: string | null
  category: AnomalyCategory
  category_other?: string | null
  description?: string | null
  reported_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_anomalies')
    .insert({
      intervention_id: input.intervention_id,
      engagement_id: input.engagement_id ?? null,
      category: input.category,
      category_other: input.category_other ?? null,
      description: input.description ?? null,
      status: 'open' as AnomalyStatus,
      reported_by: input.reported_by,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// ----- Validations -----
export async function getValidationByIntervention(interventionId: string): Promise<DbInterventionValidation | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_validations')
    .select('*')
    .eq('intervention_id', interventionId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createValidation(input: {
  intervention_id: string
  validated_by: string
  comment?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_validations')
    .insert({
      intervention_id: input.intervention_id,
      validated_by: input.validated_by,
      comment: input.comment ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/**
 * List interventions where the given agent is in the team[] array.
 * Used by the mobile agent UI (/m).
 *
 * Returns interventions ordered by scheduled_at ascending, within the past 24h
 * to next 7 days window. Slice 6.4 : les interventions « skipped » (Pas
 * aujourd'hui) sont conservées dans la liste — la doctrine veut un affichage
 * grisé + badge, pas une disparition. Le rendu côté UI applique le style.
 */
export async function listInterventionsByAgent(agentId: string): Promise<DbIntervention[]> {
  const supabase = createAdminClient()
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const inOneWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('interventions')
    .select('*')
    .contains('team', [agentId])
    .gte('scheduled_at', yesterday)
    .lte('scheduled_at', inOneWeek)
    .order('scheduled_at', { ascending: true })
  if (error) throw error
  return data ?? []
}
