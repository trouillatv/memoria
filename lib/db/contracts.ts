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

export interface ContractListQuery {
  status?: ContractStatus
  search?: string
  offset?: number
  limit?: number
}

export interface ContractListResult {
  items: DbContract[]
  total: number
}

/**
 * Liste paginée des contrats du tenant.
 * Filtres optionnels : status, search (name + client_name).
 */
export async function listContractsPaged(query: ContractListQuery = {}): Promise<ContractListResult> {
  const supabase = createAdminClient()
  let q = supabase
    .from('contracts')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (query.status) q = q.eq('status', query.status)
  if (query.search) {
    const s = query.search.replace(/[%_]/g, '\\$&')
    q = q.or(`name.ilike.%${s}%,client_name.ilike.%${s}%`)
  }

  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.max(1, query.limit ?? 50)
  q = q.range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw error
  return {
    items: (data ?? []) as DbContract[],
    total: count ?? 0,
  }
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
