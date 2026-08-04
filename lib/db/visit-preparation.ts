import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export interface PrepItem {
  id: string
  siteId: string
  organizationId: string
  stableKey: string
  label: string
  sourceKind: string
  sourceRef: string | null
  canonicalSubjectId: string | null
  priority: 'critical' | 'important' | 'normal'
  reason: string | null
  preparedBy: string
  createdAt: string
}

const COLS = 'id, site_id, organization_id, stable_key, label, source_kind, source_ref, canonical_subject_id, priority, reason, prepared_by, created_at'

function toRow(r: Record<string, unknown>): PrepItem {
  return {
    id: r.id as string,
    siteId: r.site_id as string,
    organizationId: r.organization_id as string,
    stableKey: r.stable_key as string,
    label: r.label as string,
    sourceKind: r.source_kind as string,
    sourceRef: r.source_ref as string | null,
    canonicalSubjectId: r.canonical_subject_id as string | null,
    priority: (r.priority as 'critical' | 'important' | 'normal') ?? 'normal',
    reason: r.reason as string | null,
    preparedBy: r.prepared_by as string,
    createdAt: r.created_at as string,
  }
}

/** Sélections actives (non consommées) de cet utilisateur pour ce chantier. */
export async function listActivePreparationItems(siteId: string, userId: string): Promise<PrepItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_visit_preparation_item')
    .select(COLS)
    .eq('site_id', siteId)
    .eq('prepared_by', userId)
    .is('consumed_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(toRow)
}

export interface UpsertPrepItemInput {
  siteId: string
  organizationId: string
  stableKey: string
  label: string
  sourceKind: string
  sourceRef?: string | null
  canonicalSubjectId?: string | null
  priority: 'critical' | 'important' | 'normal'
  reason?: string | null
  preparedBy: string
}

/** Ajoute une sélection. Idempotent : si la même stable_key existe déjà (active),
 *  met à jour le label/reason (cas où les données ont évolué). */
export async function upsertPreparationItem(input: UpsertPrepItemInput): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_visit_preparation_item')
    .upsert(
      {
        site_id: input.siteId,
        organization_id: input.organizationId,
        stable_key: input.stableKey,
        label: input.label,
        source_kind: input.sourceKind,
        source_ref: input.sourceRef ?? null,
        canonical_subject_id: input.canonicalSubjectId ?? null,
        priority: input.priority,
        reason: input.reason ?? null,
        prepared_by: input.preparedBy,
      },
      { onConflict: 'site_id,prepared_by,stable_key', ignoreDuplicates: false },
    )
  if (error) throw error
}

/** Retire une sélection active. Silencieux si déjà consommée ou absente. */
export async function removePreparationItem(id: string, userId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_visit_preparation_item')
    .delete()
    .eq('id', id)
    .eq('prepared_by', userId)
    .is('consumed_at', null)
  if (error) throw error
}

/** Marque toutes les sélections actives comme consommées et les retourne.
 *  Appelé par startVisitAction() — ces items alimentent le seedWatchlist(). */
export async function consumePreparationItems(
  siteId: string,
  userId: string,
  reportId: string,
): Promise<PrepItem[]> {
  const supabase = createAdminClient()
  // Lecture + marquage en deux étapes pour avoir les items à retourner.
  const { data: active, error: readErr } = await supabase
    .from('site_visit_preparation_item')
    .select(COLS)
    .eq('site_id', siteId)
    .eq('prepared_by', userId)
    .is('consumed_at', null)
  if (readErr) throw readErr

  const items = ((active ?? []) as Record<string, unknown>[]).map(toRow)
  if (items.length === 0) return []

  const ids = items.map((i) => i.id)
  const { error: updateErr } = await supabase
    .from('site_visit_preparation_item')
    .update({
      consumed_at: new Date().toISOString(),
      consumed_by_report_id: reportId,
    })
    .in('id', ids)
  if (updateErr) throw updateErr

  return items
}
