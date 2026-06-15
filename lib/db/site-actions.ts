// lib/db/site-actions.ts
// "Actions ouvertes" d'un site (migration 099) — LE nouvel objet central.
// Une réunion de chantier produit d'abord des actions ouvertes ; seules
// certaines deviennent des interventions planifiées.
// Cycle : open → planned (→ intervention) → done | cancelled.
// Regroupées par corps d'état, affectables à un responsable pressenti.
// "Réunion chantier #N" = une vue sur ces actions (ouvertes vs clôturées).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { actionHealth, type ActionHealth } from '@/lib/actions/health'
import type { DbSiteAction, SiteActionStatus } from '@/types/db'

// Re-export pour compat : la fonction pure vit dans lib/actions/health (sans
// dépendance serveur, importable côté client).
export { actionHealth }
export type { ActionHealth }

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

/** Action enrichie pour les cockpits (fiche site, briefing, /actions). */
export interface SiteActionRow {
  id: string
  title: string
  body: string | null
  corps_etat: string | null
  assigned_to: string | null
  status: SiteActionStatus
  created_at: string
  due_date: string | null
  report_id: string | null
  converted_to_type: string | null
  converted_to_id: string | null
  site_id: string
  site_name: string
  contract_id: string | null
  contract_name: string | null
}

/**
 * Actions d'un (ou tous les) site(s), enrichies du nom de site + contrat.
 * Sert les surfaces transverses : briefing, /actions, et la fiche site.
 * Par défaut : statut 'open', toute l'organisation, plus ancienne d'abord
 * (« ce qui traîne » remonte en premier).
 */
export async function listOpenSiteActions(opts?: {
  statuses?: SiteActionStatus[]
  /** Restreindre à ces sites (sinon : tous les sites de l'organisation). */
  siteIds?: string[]
}): Promise<SiteActionRow[]> {
  const supabase = createAdminClient()
  const statuses = opts?.statuses ?? ['open']

  // Résoudre les sites (scope organisation) + leurs métadonnées.
  let siteIds = opts?.siteIds ?? null
  let sitesQ = supabase.from('sites').select('id, name, contract_id').is('deleted_at', null)
  const orgId = await getOrgId()
  if (orgId) sitesQ = sitesQ.eq('organization_id', orgId)
  if (siteIds) sitesQ = sitesQ.in('id', siteIds)
  const { data: siteRows } = await sitesQ
  const sites = (siteRows ?? []) as Array<{ id: string; name: string; contract_id: string | null }>
  if (sites.length === 0) return []
  siteIds = sites.map((s) => s.id)

  const siteById = new Map(sites.map((s) => [s.id, s]))
  const contractIds = [...new Set(sites.map((s) => s.contract_id).filter((v): v is string => !!v))]
  const contractName = new Map<string, string>()
  if (contractIds.length > 0) {
    const { data: cs } = await supabase.from('contracts').select('id, name').in('id', contractIds)
    for (const c of (cs ?? []) as Array<{ id: string; name: string }>) contractName.set(c.id, c.name)
  }

  const { data, error } = await supabase
    .from('site_actions')
    .select('*')
    .in('site_id', siteIds)
    .in('status', statuses)
    .order('created_at', { ascending: true })
  if (error) throw error

  return ((data ?? []) as DbSiteAction[]).map((a) => {
    const s = siteById.get(a.site_id)
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      corps_etat: a.corps_etat,
      assigned_to: a.assigned_to,
      status: a.status,
      created_at: a.created_at,
      due_date: a.due_date,
      report_id: a.report_id,
      converted_to_type: a.converted_to_type,
      converted_to_id: a.converted_to_id,
      site_id: a.site_id,
      site_name: s?.name ?? '—',
      contract_id: s?.contract_id ?? null,
      contract_name: s?.contract_id ? contractName.get(s.contract_id) ?? null : null,
    }
  })
}

/** Actions ouvertes nées de réunions données, enrichies (pour la vue
 *  « actions ouvertes groupées par réunion » sur /meetings). */
export async function listOpenSiteActionsByReports(reportIds: string[]): Promise<SiteActionRow[]> {
  if (reportIds.length === 0) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_actions')
    .select('*')
    .in('report_id', reportIds)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as DbSiteAction[]
  if (rows.length === 0) return []

  const siteIds = [...new Set(rows.map((a) => a.site_id))]
  const { data: siteRows } = await supabase.from('sites').select('id, name, contract_id').in('id', siteIds)
  const sites = (siteRows ?? []) as Array<{ id: string; name: string; contract_id: string | null }>
  const siteById = new Map(sites.map((s) => [s.id, s]))
  const contractIds = [...new Set(sites.map((s) => s.contract_id).filter((v): v is string => !!v))]
  const contractName = new Map<string, string>()
  if (contractIds.length > 0) {
    const { data: cs } = await supabase.from('contracts').select('id, name').in('id', contractIds)
    for (const c of (cs ?? []) as Array<{ id: string; name: string }>) contractName.set(c.id, c.name)
  }

  return rows.map((a) => {
    const s = siteById.get(a.site_id)
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      corps_etat: a.corps_etat,
      assigned_to: a.assigned_to,
      status: a.status,
      created_at: a.created_at,
      due_date: a.due_date,
      report_id: a.report_id,
      converted_to_type: a.converted_to_type,
      converted_to_id: a.converted_to_id,
      site_id: a.site_id,
      site_name: s?.name ?? '—',
      contract_id: s?.contract_id ?? null,
      contract_name: s?.contract_id ? contractName.get(s.contract_id) ?? null : null,
    }
  })
}

export interface OpenActionsHealth {
  total: number
  critique: number
  surveiller: number
  rythme: number
}

/** Compteur santé des actions ouvertes (org) — pour le badge de navigation.
 *  Léger : ne récupère que created_at. Résilient si le socle n'est pas migré. */
export async function getOpenActionsHealth(): Promise<OpenActionsHealth> {
  const empty = { total: 0, critique: 0, surveiller: 0, rythme: 0 }
  try {
    const supabase = createAdminClient()
    const orgId = await getOrgId()
    let sitesQ = supabase.from('sites').select('id').is('deleted_at', null)
    if (orgId) sitesQ = sitesQ.eq('organization_id', orgId)
    const { data: siteRows } = await sitesQ
    const siteIds = (siteRows ?? []).map((s) => (s as { id: string }).id)
    if (siteIds.length === 0) return empty
    const { data, error } = await supabase
      .from('site_actions')
      .select('created_at')
      .eq('status', 'open')
      .in('site_id', siteIds)
    if (error) return empty
    const now = Date.now()
    const out = { ...empty }
    for (const r of (data ?? []) as Array<{ created_at: string }>) {
      out.total++
      out[actionHealth(r.created_at, now)]++
    }
    return out
  } catch {
    return empty
  }
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
