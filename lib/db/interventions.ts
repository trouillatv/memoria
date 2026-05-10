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
