import { createAdminClient } from '@/lib/supabase/admin'
import type { DbSite } from '@/types/db'

export async function listSites(): Promise<DbSite[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function listSitesByContract(contractId: string): Promise<DbSite[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function createSite(input: {
  client_id: string
  contract_id: string | null
  name: string
  address?: string | null
  notes?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .insert({
      client_id: input.client_id,
      contract_id: input.contract_id,
      name: input.name,
      address: input.address ?? null,
      notes: input.notes ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}
