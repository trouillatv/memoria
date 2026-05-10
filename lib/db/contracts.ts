import { createAdminClient } from '@/lib/supabase/admin'
import type { DbContract, ContractStatus } from '@/types/db'

export async function getContract(id: string): Promise<DbContract | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function listContracts(): Promise<DbContract[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createContract(input: {
  tender_id: string | null
  name: string
  client_name: string
  start_date: string
  end_date?: string | null
  created_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contracts')
    .insert({
      tender_id: input.tender_id,
      name: input.name,
      client_name: input.client_name,
      start_date: input.start_date,
      end_date: input.end_date ?? null,
      status: 'active' as ContractStatus,
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updateContractStatus(id: string, status: ContractStatus): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('contracts')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}
