import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
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
  // P1 isolation : l'organisation vient du CHANTIER (pas de la session).
  // Une mission sans org est invisible sur toute surface scopée — on refuse
  // de la créer plutôt que de créer une orpheline (fail-closed à l'écriture).
  const { data: site } = await supabase
    .from('sites')
    .select('organization_id')
    .eq('id', input.site_id)
    .maybeSingle()
  const orgId = site?.organization_id ?? (await getOrgId())
  if (!orgId) throw new Error('Chantier sans organisation — création de mission impossible')
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
      organization_id: orgId,
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
  // L'ÉQUIPE qui porte la mission. La colonne existait depuis la mig 023 et
  // n'était écrite par AUCUN écran — seulement par les scripts de seed. D'où
  // des interventions générées toutes « Non-affectées » : un planning qui ne
  // disait pas QUI y va. C'est une ÉQUIPE, jamais une personne (doctrine).
  assigned_team_id: string | null
}>): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('missions').update(patch).eq('id', id)
  if (error) throw error
}

// ── Retirer une mission (lot D) ─────────────────────────────────────────────
// La décision hard/soft vit dans lib/removal/policy.ts ; ici on ne fait
// qu'écrire. `missions.deleted_at` existait depuis la mig 018 mais n'avait
// JAMAIS été écrite — d'où « je ne peux pas nettoyer mes essais ».

/** Nombre d'interventions rattachées (toutes, y compris passées : ce sont
 *  elles qui portent les preuves). Décide hard vs soft. */
export async function countInterventionsForMission(missionId: string): Promise<number> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from('interventions')
    .select('id', { count: 'exact', head: true })
    .eq('mission_id', missionId)
  if (error) throw error
  return count ?? 0
}

/** Retire la mission des écrans. L'historique des interventions reste lisible. */
export async function softDeleteMission(missionId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('missions')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', missionId)
    .is('deleted_at', null)
  if (error) throw error
}

/** Supprime définitivement une mission SANS descendance (brouillon d'essai).
 *  L'appelant DOIT avoir vérifié countInterventionsForMission() === 0 : la FK
 *  interventions.mission_id est en ON DELETE CASCADE (mig 018:66) et
 *  emporterait les photos-preuves. */
export async function hardDeleteMission(missionId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('missions').delete().eq('id', missionId)
  if (error) throw error
}
