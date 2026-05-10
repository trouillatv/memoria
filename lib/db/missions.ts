import { createAdminClient } from '@/lib/supabase/admin'
import type { DbMission, MissionCadence, ChecklistTemplateItem } from '@/types/db'

export async function listMissionsBySite(siteId: string): Promise<DbMission[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function listMissionsByContract(contractId: string): Promise<DbMission[]> {
  // Join through sites to find missions for this contract
  const supabase = createAdminClient()
  const { data: sites, error: sitesErr } = await supabase
    .from('sites')
    .select('id')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
  if (sitesErr) throw sitesErr
  if (!sites || sites.length === 0) return []
  const siteIds = sites.map((s) => s.id)
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .in('site_id', siteIds)
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function getMission(id: string): Promise<DbMission | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createMission(input: {
  site_id: string
  name: string
  description?: string | null
  cadence: MissionCadence
  default_team?: string[]
  engagement_ids?: string[]
  default_checklist?: ChecklistTemplateItem[]
  created_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('missions')
    .insert({
      site_id: input.site_id,
      name: input.name,
      description: input.description ?? null,
      cadence: input.cadence,
      default_team: input.default_team ?? [],
      engagement_ids: input.engagement_ids ?? [],
      default_checklist: input.default_checklist ?? [],
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updateMission(id: string, patch: Partial<{
  name: string
  description: string | null
  cadence: MissionCadence
  default_team: string[]
  engagement_ids: string[]
  default_checklist: ChecklistTemplateItem[]
  active: boolean
}>): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('missions').update(patch).eq('id', id)
  if (error) throw error
}
