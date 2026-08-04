'use server'

import { createClient } from '@/lib/supabase/server'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { listActivePreparationItems, removePreparationItem } from '@/lib/db/visit-preparation'

export type PlanItemSummary = {
  id: string
  label: string
  priority: 'critical' | 'important' | 'normal'
  reason: string | null
  sourceKind: string
}

export async function fetchPlanItems(siteId: string): Promise<PlanItemSummary[]> {
  try {
    await requireSiteAccess(siteId)
  } catch {
    return []
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const items = await listActivePreparationItems(siteId, user.id)
  return items.map((i) => ({
    id: i.id,
    label: i.label,
    priority: i.priority,
    reason: i.reason,
    sourceKind: i.sourceKind,
  }))
}

export type RemovePlanItemResult = { ok: true } | { ok: false; error: string }

export async function removePlanItem(itemId: string, siteId: string): Promise<RemovePlanItemResult> {
  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  try {
    await removePreparationItem(itemId, user.id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
