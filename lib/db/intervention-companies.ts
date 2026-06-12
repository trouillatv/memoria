// ============================================================================
// lib/db/intervention-companies.ts
// ============================================================================
//
// Helpers DB pour `intervention_companies`.
//
// Doctrine : ne stocke que des entités commerciales (raison sociale),
// jamais des individus. Pour les personnes internes, voir
// lib/db/intervention-participants.ts.
//
// Interface minimaliste — 3 opérations seulement :
//   list   : lecture par intervention (contexte connu)
//   add    : admin/manager uniquement
//   remove : admin/manager uniquement

import { createAdminClient } from '@/lib/supabase/admin'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface InterventionCompany {
  id: string
  intervention_id: string
  company_name: string
  role_description: string | null
  created_at: string
}

// ----------------------------------------------------------------------------
// READ
// ----------------------------------------------------------------------------

/**
 * Liste les entreprises externes enregistrées sur une intervention.
 * Lookup par intervention_id uniquement.
 */
export async function listCompaniesForIntervention(
  interventionId: string,
): Promise<InterventionCompany[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_companies')
    .select('id, intervention_id, company_name, role_description, created_at')
    .eq('intervention_id', interventionId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as InterventionCompany[]
}

// ----------------------------------------------------------------------------
// WRITE
// ----------------------------------------------------------------------------

/**
 * Ajoute une entreprise externe sur une intervention.
 * Le caller doit être admin ou manager (contrôlé côté RLS également).
 */
export async function addCompanyToIntervention(params: {
  interventionId: string
  companyName: string
  roleDescription?: string
  createdBy: string
  organizationId?: string
}): Promise<InterventionCompany> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_companies')
    .insert({
      intervention_id: params.interventionId,
      company_name: params.companyName,
      role_description: params.roleDescription ?? null,
      created_by: params.createdBy,
      organization_id: params.organizationId ?? null,
    })
    .select('id, intervention_id, company_name, role_description, created_at')
    .single()

  if (error) throw error
  return data as InterventionCompany
}

/**
 * Supprime une entrée entreprise par son id.
 * Admin/manager uniquement (contrôlé côté RLS également).
 */
export async function removeCompanyFromIntervention(companyId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('intervention_companies')
    .delete()
    .eq('id', companyId)

  if (error) throw error
}
