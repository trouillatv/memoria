import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbTender, DbTenderDocument, DbTenderAnalysis, TenderStatus } from '@/types/db'

export interface TenderListQuery {
  status?: TenderStatus
  search?: string
  /** 0-based offset. */
  offset?: number
  /** Max items returned. */
  limit?: number
}

export interface TenderListResult {
  items: DbTender[]
  total: number
}

/**
 * Liste paginée des AO du tenant.
 * Filtres optionnels : status, search (title + client_name).
 * Renvoie items + total pour permettre la pagination côté UI.
 */
export async function listTendersPaged(query: TenderListQuery = {}): Promise<TenderListResult> {
  const supabase = await createServerClient()
  let q = supabase
    .from('tenders')
    .select('id, title, client_name, deadline, status, opportunity_score, error_msg, created_by, created_at, deleted_at', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (query.status) q = q.eq('status', query.status)
  if (query.search) {
    const s = query.search.replace(/[%_]/g, '\\$&')
    q = q.or(`title.ilike.%${s}%,client_name.ilike.%${s}%`)
  }

  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.max(1, query.limit ?? 50)
  q = q.range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw error
  return {
    items: (data ?? []) as DbTender[],
    total: count ?? 0,
  }
}

/**
 * Variante legacy non paginée — conservée pour compat. Renvoie l'array brut.
 */
export async function listTenders(query: TenderListQuery = {}): Promise<DbTender[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('tenders')
    .select('id, title, client_name, deadline, status, opportunity_score, error_msg, created_by, created_at, deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (query.status) q = q.eq('status', query.status)
  if (query.search) {
    const s = query.search.replace(/[%_]/g, '\\$&')
    q = q.or(`title.ilike.%${s}%,client_name.ilike.%${s}%`)
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DbTender[]
}

export async function getTender(id: string): Promise<DbTender | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tenders')
    .select('id, title, client_name, deadline, status, opportunity_score, error_msg, created_by, created_at, deleted_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as DbTender
}

export async function createTender(input: {
  title: string
  client_name?: string | null
  deadline?: string | null
  created_by: string
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title: input.title,
      client_name: input.client_name ?? null,
      deadline: input.deadline ?? null,
      status: 'draft',
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}

export async function updateTenderStatus(
  id: string,
  status: TenderStatus,
  errorMsg?: string | null,
  opportunityScore?: number | null
): Promise<void> {
  const supabase = createAdminClient()
  const fields: Record<string, unknown> = { status }
  if (errorMsg !== undefined) fields.error_msg = errorMsg
  if (opportunityScore !== undefined) fields.opportunity_score = opportunityScore
  const { error } = await supabase.from('tenders').update(fields).eq('id', id)
  if (error) throw error
}

export async function softDeleteTender(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('tenders')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function createTenderDocument(input: {
  tender_id: string
  storage_path: string
  filename: string
  size_bytes: number
  page_count?: number | null
  extracted_text?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_documents')
    .insert(input)
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}

export async function getTenderDocument(tenderId: string): Promise<DbTenderDocument | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_documents')
    .select('id, tender_id, storage_path, filename, size_bytes, page_count, extracted_text, uploaded_at')
    .eq('tender_id', tenderId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as DbTenderDocument
}

export async function getLatestTenderAnalysis(tenderId: string): Promise<DbTenderAnalysis | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_analyses')
    .select('id, tender_id, provider, model, prompt_versions, summary, constraints, risks, checklist, technical_memo, library_snapshot, raw_response, created_at')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as DbTenderAnalysis
}

export async function insertTenderAnalysis(input: Omit<DbTenderAnalysis, 'id' | 'created_at'>): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_analyses')
    .insert(input)
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}

export async function countAnalysesToday(): Promise<number> {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('feature', 'lecteur_ao')
    .gte('created_at', since)
  if (error) throw error
  return count ?? 0
}
