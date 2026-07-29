// lib/db/visit-watchlist.ts
// Liste « À vérifier » d'une visite (mig 196) — accès données.
//
// Artefact de session : préparé au démarrage (seed déterministe), coché pendant,
// soldé au débrief, conservé dans la mémoire de la visite. Jamais surfacé comme
// une « tâche » du chantier ; la promotion d'un « à suivre » en action/réserve
// est un geste HUMAIN explicite (debrief-actions), jamais automatique.

import { createAdminClient } from '@/lib/supabase/admin'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import type { DbVisitWatchlistItem, WatchlistItemPriority, WatchlistItemState } from '@/types/db'
import type { WatchlistProposal } from '@/lib/visits/watchlist-proposals'
import type { WatchlistDebriefItem } from '@/lib/visits/watchlist-debrief-block'

const COLS = 'id, report_id, site_id, organization_id, label, position, state, note, source_kind, source_ref, capture_id, promoted_to, promoted_ref, created_by, created_at, updated_at, priority, reason'

export async function listWatchlist(reportId: string): Promise<DbVisitWatchlistItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_watchlist_item')
    .select(COLS)
    .eq('report_id', reportId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data ?? []) as DbVisitWatchlistItem[]
}

/** Fige la liste de contrôle de CETTE visite. Idempotent : si la visite a déjà
 *  une liste (re-démarrage, reprise), on ne re-seed jamais — la liste vit. */
export async function seedWatchlist(input: {
  reportId: string
  siteId: string
  createdBy: string | null
  proposals: WatchlistProposal[]
}): Promise<void> {
  if (input.proposals.length === 0) return
  const supabase = createAdminClient()
  const { count } = await supabase
    .from('visit_watchlist_item')
    .select('id', { count: 'exact', head: true })
    .eq('report_id', input.reportId)
  if ((count ?? 0) > 0) return
  const { data: site } = await supabase.from('sites').select('organization_id').eq('id', input.siteId).maybeSingle()
  if (!site) throw new Error('Chantier introuvable')
  const membership = await requireOrganizationMembership(site.organization_id)
  if (!membership.ok) throw new Error(membership.error)
  const rows = input.proposals.map((p, i) => ({
    report_id: input.reportId,
    site_id: input.siteId,
    organization_id: site.organization_id,
    label: p.label,
    position: i,
    source_kind: p.source_kind,
    source_ref: p.source_ref,
    priority: p.priority,
    reason: p.reason,
    created_by: input.createdBy,
  }))
  const { error } = await supabase.from('visit_watchlist_item').insert(rows)
  if (error) throw error
}

/** Point ajouté à la main pendant la visite (« et vérifie aussi… »). */
export async function addWatchlistItem(input: {
  reportId: string
  siteId: string
  label: string
  createdBy: string | null
}): Promise<DbVisitWatchlistItem> {
  const supabase = createAdminClient()
  const { data: last } = await supabase
    .from('visit_watchlist_item')
    .select('position')
    .eq('report_id', input.reportId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data: site } = await supabase.from('sites').select('organization_id').eq('id', input.siteId).maybeSingle()
  if (!site) throw new Error('Chantier introuvable')
  const membership = await requireOrganizationMembership(site.organization_id)
  if (!membership.ok) throw new Error(membership.error)
  const { data, error } = await supabase
    .from('visit_watchlist_item')
    .insert({
      report_id: input.reportId,
      site_id: input.siteId,
      organization_id: site.organization_id,
      label: input.label,
      position: ((last as { position: number } | null)?.position ?? -1) + 1,
      source_kind: 'manual',
      created_by: input.createdBy,
    })
    .select(COLS)
    .single()
  if (error) throw error
  return data as DbVisitWatchlistItem
}

export async function setWatchlistItemState(
  id: string,
  state: WatchlistItemState,
  note?: string | null,
): Promise<void> {
  const supabase = createAdminClient()
  const patch: Record<string, unknown> = { state, updated_at: new Date().toISOString() }
  if (note !== undefined) patch.note = note
  const { error } = await supabase.from('visit_watchlist_item').update(patch).eq('id', id)
  if (error) throw error
}

/** Lit les points de contrôle et leurs preuves pour injection dans le débrief IA.
 *  Retourne [] si la visite n'a pas de plan de visite (seed non déclenché). */
export async function getWatchlistForDebrief(reportId: string): Promise<WatchlistDebriefItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_watchlist_item')
    .select('id, label, priority, state, note')
    .eq('report_id', reportId)
    .order('position', { ascending: true })
  if (error) throw error
  const items = data ?? []
  if (items.length === 0) return []

  const ids = items.map((i) => i.id)
  const { data: evidences } = await supabase
    .from('visit_capture_watchlist_item')
    .select('item_id')
    .in('item_id', ids)

  const countMap = new Map<string, number>()
  for (const e of evidences ?? []) {
    countMap.set(e.item_id, (countMap.get(e.item_id) ?? 0) + 1)
  }

  return items.map((row) => ({
    label: row.label,
    priority: row.priority as WatchlistItemPriority,
    state: row.state as WatchlistItemState,
    note: row.note ?? null,
    evidenceCount: countMap.get(row.id) ?? 0,
  }))
}

/** Lie une capture à un point de contrôle (table M-M mig 255).
 *  Idempotent : la contrainte UNIQUE (item_id, capture_id) absorbe les doublons. */
export async function addWatchlistEvidence(itemId: string, captureId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('visit_capture_watchlist_item')
    .upsert({ item_id: itemId, capture_id: captureId }, { onConflict: 'item_id,capture_id', ignoreDuplicates: true })
  if (error) throw error
}

/** Trace la promotion HUMAINE d'un « toujours ouvert » en objet chantier. */
export async function markWatchlistItemPromoted(
  id: string,
  promotedTo: 'action' | 'reserve',
  promotedRef: string,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('visit_watchlist_item')
    .update({ promoted_to: promotedTo, promoted_ref: promotedRef, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
