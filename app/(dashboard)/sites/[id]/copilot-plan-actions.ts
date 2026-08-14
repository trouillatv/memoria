'use server'

import { createClient } from '@/lib/supabase/server'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { listActivePreparationItems, removePreparationItem } from '@/lib/db/visit-preparation'
import { buildSiteIntelligenceContext } from '@/lib/knowledge/build-site-intelligence-context'
import { getSiteOverview } from '@/lib/knowledge/site-overview'
import { buildSiteCopilotContext, availableQuickIntents, type CopilotIntent } from '@/lib/visits/copilot-context'

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

export type CopilotSuggestions = {
  /**
   * Raccourcis réellement pertinents pour ce chantier. Vide n'arrive jamais :
   * un repli générique minimal est retourné pour un chantier presque vide.
   */
  quickIntents: CopilotIntent[]
  /** Questions dérivées des sujets réels — jamais un exemple statique. */
  contextual: string[]
}

// Repli générique minimal : "attention" répond honnêtement "aucun point
// d'attention identifié" sur un chantier vide — jamais un exemple inventé.
const FALLBACK_QUICK_INTENTS: CopilotIntent[] = ['attention']

// Suggestions du Copilote dérivées de ce que MemorIA sait RÉELLEMENT du chantier —
// jamais d'exemple statique (ex. "De quoi dépend l'avis G3 ?" affiché sur un
// chantier sans G3, défaut Copilote V2, retour Guillaume).
//
// Les raccourcis passent par le MÊME moteur que les réponses
// (buildSiteCopilotContext + filtre par intention) : un raccourci affiché ne peut
// donc pas mener à un "je n'ai pas d'informations".
export async function getCopilotSuggestions(siteId: string): Promise<CopilotSuggestions> {
  try {
    await requireSiteAccess(siteId)
  } catch {
    return { quickIntents: FALLBACK_QUICK_INTENTS, contextual: [] }
  }

  const [quickIntents, contextual] = await Promise.all([
    computeQuickIntents(siteId),
    computeContextualQuestions(siteId),
  ])

  return { quickIntents, contextual }
}

async function computeQuickIntents(siteId: string): Promise<CopilotIntent[]> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const [overview, prepItems] = await Promise.all([
      getSiteOverview(siteId),
      user
        ? listActivePreparationItems(siteId, user.id).catch(() => [])
        : Promise.resolve([]),
    ])

    const context = buildSiteCopilotContext(
      siteId,
      overview.identity.name,
      overview,
      prepItems.map((p) => ({ label: p.label, stableKey: p.stableKey })),
    )
    const available = availableQuickIntents(context)
    return available.length > 0 ? available : FALLBACK_QUICK_INTENTS
  } catch {
    // Chargement en échec ≠ chantier vide : on n'en déduit rien, on affiche le repli.
    return FALLBACK_QUICK_INTENTS
  }
}

async function computeContextualQuestions(siteId: string): Promise<string[]> {
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
