// lib/db/site-actions.ts
// "Actions ouvertes" d'un site (migration 099) — LE nouvel objet central.
// Une réunion de chantier produit d'abord des actions ouvertes ; seules
// certaines deviennent des interventions planifiées.
// Cycle : open → planned (→ intervention) → done | cancelled.
// Regroupées par corps d'état, affectables à un responsable pressenti.
// "Réunion chantier #N" = une vue sur ces actions (ouvertes vs clôturées).

import { createAdminClient } from '@/lib/supabase/admin'
import type { DbSiteAction, SiteActionStatus } from '@/types/db'

export async function createSiteAction(input: {
  site_id: string
  report_id?: string | null
  title: string
  body?: string | null
  corps_etat?: string | null
  assigned_to?: string | null
  due_date?: string | null
  created_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_actions')
    .insert({
      site_id: input.site_id,
      report_id: input.report_id ?? null,
      title: input.title,
      body: input.body ?? null,
      corps_etat: input.corps_etat ?? null,
      assigned_to: input.assigned_to ?? null,
      due_date: input.due_date ?? null,
      created_by: input.created_by,
      status: 'open' as SiteActionStatus,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function listSiteActionsBySite(
  siteId: string,
  opts?: { status?: SiteActionStatus | SiteActionStatus[] },
): Promise<DbSiteAction[]> {
  const supabase = createAdminClient()
  let q = supabase
    .from('site_actions')
    .select('*')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
  if (opts?.status) {
    q = Array.isArray(opts.status) ? q.in('status', opts.status) : q.eq('status', opts.status)
  }
  const { data, error } = await q
  if (error) throw error
  return (data as DbSiteAction[]) ?? []
}

export async function listSiteActionsByReport(reportId: string): Promise<DbSiteAction[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_actions')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as DbSiteAction[]) ?? []
}

export async function markSiteActionDone(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_actions')
    .update({ status: 'done', done_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function cancelSiteAction(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_actions')
    .update({ status: 'cancelled' })
    .eq('id', id)
  if (error) throw error
}

/** Action planifiée → trace de l'intervention/mission créée (status='planned'). */
export async function markSiteActionPlanned(
  id: string,
  toType: 'mission' | 'intervention',
  toId: string,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_actions')
    .update({ status: 'planned', converted_to_type: toType, converted_to_id: toId })
    .eq('id', id)
  if (error) throw error
}
