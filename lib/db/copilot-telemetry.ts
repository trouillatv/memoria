// lib/db/copilot-telemetry.ts
// Écriture best-effort dans copilot_interactions (mig 294).
//
// INVARIANTS :
//   1. Ne lève JAMAIS — un échec de tracking ne casse pas le Copilote.
//   2. Cloisonné org : sans organisation lisible, on n'écrit rien.
//   3. answer_text complet stocké — exposé uniquement dans le drawer admin.
//   4. Append-only après insert (updateCopilotInteraction pour les champs évolutifs).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

export type CopilotScope =
  | 'site'
  | 'canonical_subject'
  | 'action'
  | 'actor'
  | 'visit'
  | 'meeting'
  | 'historical_pv'
  | 'report'
  | 'visit_plan'
  | 'dependencies'
  | 'unknown'

export type CopilotAnswerMode = 'llm' | 'deterministic_fallback' | 'clarification'

export type CopilotAnswerStatus =
  | 'answered'
  | 'not_found'
  | 'ambiguous'
  | 'insufficient_data'
  | 'provider_error'

export interface CopilotInteractionInput {
  siteId: string | null
  userId: string | null
  conversationId: string | null

  // Demande
  question: string
  conversationMode: 'guided' | 'free'
  guidedIntent?: string | null

  // Compréhension
  primaryIntent: string | null
  secondaryIntents: string[]
  scope: CopilotScope
  resolvedSubjectIds: string[]

  // Réponse
  answerText: string | null
  answerMode: CopilotAnswerMode
  answerStatus: CopilotAnswerStatus
  citedReferenceCount: number
  sourcesUsed: string[]

  // Technique
  model: string | null
  promptVersion: string | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostEur: number | null
  latencyMs: number
  usedFallback: boolean

  // Proposition 3C
  proposalKind?: 'action' | 'visit_item' | null
  proposalId?: string | null
  proposalStatus?: 'none' | 'shown'
}

/**
 * Insère une ligne dans copilot_interactions. Best-effort : ne lève jamais.
 * Retourne l'ID de la ligne créée, ou null si l'insertion a échoué.
 */
export async function logCopilotInteraction(
  input: CopilotInteractionInput,
): Promise<string | null> {
  try {
    const orgId = await getOrgId().catch(() => null)
    if (!orgId) return null

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('copilot_interactions')
      .insert({
        organization_id:       orgId,
        site_id:               input.siteId,
        user_id:               input.userId,
        conversation_id:       input.conversationId,
        question:              input.question.slice(0, 500),
        conversation_mode:     input.conversationMode,
        guided_intent:         input.guidedIntent ?? null,
        primary_intent:        input.primaryIntent,
        secondary_intents:     input.secondaryIntents,
        scope:                 input.scope,
        resolved_subject_ids:  input.resolvedSubjectIds,
        answer_text:           input.answerText,
        answer_mode:           input.answerMode,
        answer_status:         input.answerStatus,
        cited_reference_count: input.citedReferenceCount,
        sources_used:          input.sourcesUsed,
        model:                 input.model,
        prompt_version:        input.promptVersion,
        input_tokens:          input.inputTokens,
        output_tokens:         input.outputTokens,
        estimated_cost_eur:    input.estimatedCostEur,
        latency_ms:            input.latencyMs,
        used_fallback:         input.usedFallback,
        proposal_kind:         input.proposalKind ?? null,
        proposal_id:           input.proposalId ?? null,
        proposal_status:       input.proposalStatus ?? 'none',
      })
      .select('id')
      .single()

    if (error) return null
    return (data as { id: string }).id
  } catch {
    return null
  }
}

/**
 * Met à jour le statut d'une proposition (confirmed / cancelled).
 * Best-effort : ne lève jamais.
 */
export async function updateCopilotProposalStatus(
  interactionId: string,
  status: 'confirmed' | 'cancelled',
): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase
      .from('copilot_interactions')
      .update({ proposal_status: status })
      .eq('id', interactionId)
  } catch {
    // best-effort
  }
}

/**
 * Incrémente le compteur de clics sur les références.
 * Best-effort : ne lève jamais.
 */
export async function incrementCopilotReferenceClick(interactionId: string): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase.rpc('copilot_increment_reference_click', { p_id: interactionId })
  } catch {
    // best-effort — la fonction RPC peut ne pas exister sur les vieux envs
  }
}
