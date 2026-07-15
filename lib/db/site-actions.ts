// lib/db/site-actions.ts
// "Actions ouvertes" d'un site (migration 099) — LE nouvel objet central.
// Une réunion de chantier produit d'abord des actions ouvertes ; seules
// certaines deviennent des interventions planifiées.
// Cycle : open → planned (→ intervention) → done | cancelled.
// Regroupées par corps d'état, affectables à un responsable pressenti.
// "Réunion chantier #N" = une vue sur ces actions (ouvertes vs clôturées).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { actionHealth, actionAttentionOf, noumeaDayOf, type ActionHealth } from '@/lib/actions/health'
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
  due_date_status?: 'explicit' | 'estimated' | null
  /** Action corrective rattachée à une réserve (migration 123). */
  reserve_id?: string | null
  /** Rattachement à un sujet vivant (migration 124). */
  subject_id?: string | null
  created_by: string | null
  /** Provenance (migration 112) : mobile_site / desktop_site / actions_list / report. */
  created_from: SiteActionOrigin
  /** Type (migration 149) : one_shot (défaut) | deadline | recurring_until_done. */
  kind?: 'one_shot' | 'deadline' | 'recurring_until_done'
  /** Capture d'origine (mig 183) — traçabilité « d'où vient cette action ? ». */
  source_capture_id?: string | null
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
      due_date_status: input.due_date_status ?? null,
      reserve_id: input.reserve_id ?? null,
      subject_id: input.subject_id ?? null,
      created_by: input.created_by,
      created_from: input.created_from,
      kind: input.kind ?? 'one_shot',
      source_capture_id: input.source_capture_id ?? null,
      status: 'open' as SiteActionStatus,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/**
 * Édition d'une action (curation desktop). Tous les champs optionnels ;
 * seuls ceux fournis sont modifiés. Mettre `due_date_status` à null retire le
 * badge « à confirmer » (= l'humain a confirmé/figé l'échéance).
 */
export async function updateSiteAction(
  id: string,
  patch: {
    title?: string
    assigned_to?: string | null
    corps_etat?: string | null
    due_date?: string | null
    due_date_status?: 'explicit' | 'estimated' | null
    status?: SiteActionStatus
    kind?: 'one_shot' | 'deadline' | 'recurring_until_done'
  },
): Promise<void> {
  const supabase = createAdminClient()
  const update: Record<string, unknown> = {}
  if (patch.title !== undefined) update.title = patch.title
  if (patch.assigned_to !== undefined) update.assigned_to = patch.assigned_to
  if (patch.corps_etat !== undefined) update.corps_etat = patch.corps_etat
  if (patch.due_date !== undefined) update.due_date = patch.due_date
  if (patch.due_date_status !== undefined) update.due_date_status = patch.due_date_status
  if (patch.status !== undefined) update.status = patch.status
  if (patch.kind !== undefined) update.kind = patch.kind
  if (Object.keys(update).length === 0) return
  const { error } = await supabase.from('site_actions').update(update).eq('id', id)
  if (error) throw error
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

/** Actions correctives rattachées à une réserve (migration 123). */
export async function listSiteActionsByReserve(reserveId: string): Promise<DbSiteAction[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_actions')
    .select('*')
    .eq('reserve_id', reserveId)
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
  /** Élément à mémoriser rattaché (mig 124). null = action orpheline. */
  subject_id: string | null
  /** Dernière avancée « Fait aujourd'hui » (mig 169) — PAS une clôture. */
  last_progress_at: string | null
  /** Motif de report posé par le chef (mig 176) : explique pourquoi l'action
   *  reste ouverte (attente client/matériel, météo…). null = pas reportée. */
  snooze_reason: string | null
  snoozed_at: string | null
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
      subject_id: a.subject_id ?? null,
      last_progress_at: a.last_progress_at ?? null,
      snooze_reason: a.snooze_reason ?? null,
      snoozed_at: a.snoozed_at ?? null,
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
      subject_id: a.subject_id ?? null,
      last_progress_at: a.last_progress_at ?? null,
      snooze_reason: a.snooze_reason ?? null,
      snoozed_at: a.snoozed_at ?? null,
    }
  })
}

export interface OpenActionsHealth {
  total: number
  critique: number
  surveiller: number
  rythme: number
  /** Ce qui mérite l'œil AUJOURD'HUI (même modèle que l'accueil, cf.
   *  actionAttentionOf) — le badge mobile compte CECI, pas l'inventaire :
   *  un badge rouge permanent est une alarme par défaut (audit 2026-07-12). */
  attention: number
}

/** Compteur santé des actions ouvertes (org) — pour les badges de navigation.
 *  Léger. Résilient si le socle n'est pas migré. */
export async function getOpenActionsHealth(): Promise<OpenActionsHealth> {
  const empty = { total: 0, critique: 0, surveiller: 0, rythme: 0, attention: 0 }
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
      .select('created_at, due_date, last_progress_at, snooze_reason')
      .eq('status', 'open')
      .in('site_id', siteIds)
    if (error) return empty
    const now = Date.now()
    const today = noumeaDayOf(new Date(now).toISOString())
    const out = { ...empty }
    for (const r of (data ?? []) as Array<{ created_at: string; due_date: string | null; last_progress_at: string | null; snooze_reason: string | null }>) {
      out.total++
      out[actionHealth(r.created_at, now)]++
      if (actionAttentionOf(r, today)) out.attention++
    }
    return out
  } catch {
    return empty
  }
}

export async function markSiteActionDone(
  id: string,
  closure?: { comment?: string | null; photoPath?: string | null },
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_actions')
    .update({
      status: 'done',
      done_at: new Date().toISOString(),
      completed_comment: closure?.comment ?? null,
      completed_photo_path: closure?.photoPath ?? null,
    })
    .eq('id', id)
  if (error) throw error
}

/**
 * « Fait aujourd'hui » — marque une AVANCÉE terrain sans clôturer. status reste
 * 'open' : l'action est vivante, elle réapparaîtra dans « à faire » dès demain.
 * on=false annule la marque du jour.
 */
export async function markSiteActionProgress(id: string, on: boolean): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_actions')
    .update({ last_progress_at: on ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw error
}

/**
 * « Reporter » — pose (ou retire si reason=null) un motif expliquant pourquoi
 * l'action reste ouverte. Ne change PAS le status (reste 'open'). Léger,
 * réversible. snoozed_at horodate la pose du motif.
 */
export async function setSiteActionSnooze(id: string, reason: string | null): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_actions')
    .update({
      snooze_reason: reason,
      snoozed_at: reason ? new Date().toISOString() : null,
    })
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

export type SiteActionOrigin =
  | 'report'
  | 'desktop_report'
  | 'desktop_site'
  | 'visit_debrief'
  | 'visit_watchlist'
  | 'reserve'
  | 'actions_list'
  | 'mobile_site_report'
