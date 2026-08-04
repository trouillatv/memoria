'use server'

// Copilote Phase 2 — server action lecture seule.
// Invariant : AUCUNE écriture DB dans ce fichier.
// Le LLM reçoit un contexte structuré déterministe ; les URLs des références
// viennent exclusivement du contexte (pas du LLM).

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSiteOverview, emptySiteOverview } from '@/lib/knowledge/site-overview'
import { listActivePreparationItems } from '@/lib/db/visit-preparation'
import {
  buildSiteCopilotContext,
  filterContextForIntent,
  type CopilotIntent,
  type CopilotItem,
} from '@/lib/visits/copilot-context'
import { answerCopilotQuestion } from '@/lib/visits/copilot-answer'
import { logCopilotInteraction } from '@/lib/db/copilot-telemetry'

const GUIDED_SCOPE_MAP: Record<string, 'site' | 'action' | 'visit_plan'> = {
  attention:  'site',
  changes:    'site',
  stale:      'action',
  next_visit: 'visit_plan',
}

const inputSchema = z.object({
  siteId: z.string().uuid(),
  intent: z.enum(['attention', 'changes', 'stale', 'next_visit']),
  conversationId: z.string().uuid().optional(),
})

export interface CopilotRef {
  id: string
  label: string
  href: string | null
}

export interface CopilotActionResult {
  text: string
  references: CopilotRef[]
  source: 'llm' | 'fallback'
  interactionId: string | null
}

export async function askCopilotAction(
  input: { siteId: string; intent: CopilotIntent; conversationId?: string },
): Promise<CopilotActionResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return { text: 'Paramètres invalides.', references: [], source: 'fallback', interactionId: null }
  }
  const { siteId, intent, conversationId } = parsed.data
  const t0 = Date.now()

  // Récupérer l'utilisateur connecté pour enrichir avec son plan de visite.
  // Optionnel : si l'auth échoue, le copilote fonctionne sans les prep items.
  let userId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  } catch { /* non bloquant */ }

  // Fetch parallèle — getSiteOverview est le plus coûteux
  const [overview, prepItemsRaw] = await Promise.all([
    getSiteOverview(siteId).catch(() => emptySiteOverview(siteId)),
    userId
      ? listActivePreparationItems(siteId, userId).catch(() => [])
      : Promise.resolve([]),
  ])

  const prepItems = prepItemsRaw.map((p) => ({ label: p.label, stableKey: p.stableKey }))

  const context = buildSiteCopilotContext(
    siteId,
    overview.identity.name,
    overview,
    prepItems,
  )

  const { items, delta, prepItems: filteredPrep } = filterContextForIntent(context, intent)

  const answer = await answerCopilotQuestion(
    items,
    intent,
    delta,
    filteredPrep,
    overview.identity.name,
  )

  // Résolution des références depuis la liste FERMÉE du contexte.
  // Le LLM ne peut pas avoir inventé un id qui n'est pas dans `items`.
  const itemById = new Map<string, CopilotItem>(items.map((i) => [i.id, i]))
  const references: CopilotRef[] = answer.citedIds
    .map((id) => {
      const item = itemById.get(id)
      return item ? { id: item.id, label: item.label, href: item.href } : null
    })
    .filter((r): r is CopilotRef => r !== null)

  const latencyMs = Date.now() - t0
  const scope = GUIDED_SCOPE_MAP[intent] ?? 'site'
  const sourcesUsed = ['site_overview', ...(userId ? ['visit_preparation'] : [])]

  const interactionId = await logCopilotInteraction({
    siteId,
    userId,
    conversationId: conversationId ?? null,
    question: input.intent,   // intent label comme question pour les guidées
    conversationMode: 'guided',
    guidedIntent: intent,
    primaryIntent: intent,
    secondaryIntents: [],
    scope,
    resolvedSubjectIds: [],
    answerText: answer.text,
    answerMode: answer.source === 'llm' ? 'llm' : 'deterministic_fallback',
    answerStatus: answer.source === 'llm' ? 'answered' : (references.length === 0 ? 'insufficient_data' : 'answered'),
    citedReferenceCount: references.length,
    sourcesUsed,
    model: null,
    promptVersion: null,
    inputTokens: null,
    outputTokens: null,
    estimatedCostEur: null,
    latencyMs,
    usedFallback: answer.source === 'fallback',
  })

  return { text: answer.text, references, source: answer.source, interactionId }
}
