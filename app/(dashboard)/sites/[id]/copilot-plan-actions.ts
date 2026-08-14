'use server'

import { createClient } from '@/lib/supabase/server'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { listActivePreparationItems, removePreparationItem } from '@/lib/db/visit-preparation'
import { buildSiteIntelligenceContext } from '@/lib/knowledge/build-site-intelligence-context'

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

// Suggestions de questions dérivées du moteur d'attention du chantier réel —
// jamais d'exemple statique (ex. "De quoi dépend l'avis G3 ?" sur un chantier
// sans G3, défaut Copilote V2, retour Guillaume). Même gabarit que
// getSiteContextualSuggestionsAction (app/(dashboard)/memoire/[siteId]/actions.ts).
export async function getCopilotContextualSuggestions(siteId: string): Promise<string[]> {
  try {
    await requireSiteAccess(siteId)
  } catch {
    return []
  }

  try {
    const ctx = await buildSiteIntelligenceContext(siteId, {
      attention: true,
      maxAttentionItems: 5,
    })
    const topItems = (ctx.attention?.items ?? []).slice(0, 3)
    if (topItems.length === 0) return []

    return topItems.map((item) => {
      const label = item.title.length > 55 ? item.title.slice(0, 55) + '…' : item.title
      return `Où en est "${label}" ?`
    })
  } catch {
    return []
  }
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
