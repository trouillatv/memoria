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
  proposalKind?: 'action' | 'visit_item' | 'schedule_visit' | 'schedule_meeting' | 'observation' | 'actor_alias' | 'fact' | 'relation_claim' | null
  proposalId?: string | null
  proposalStatus?: 'none' | 'shown'

  // Copilote vocal (mig 296)
  voiceUsed?: boolean
  audioDurationMs?: number | null
  transcriptionLatencyMs?: number | null
  transcriptionModel?: string | null
  transcriptionTokensAudio?: number | null
  transcriptionTokensOutput?: number | null
  transcriptionError?: string | null

  // Audit Copilote — brique 2 (mig 324+325)
  /** Texte brut du STT avant normalizeTranscript() — diagnostic uniquement. */
  transcriptionRaw?: string | null
  transcriptionCorrections?: { from: string; to: string }[] | null
  /** Nombre de termes que le normaliseur a refusé de corriger faute de confiance. */
  transcriptionAbstentions?: number | null
  /** client_live (P3-B) / server_stt (P2-C) / typed (question tapée). */
  sttRoute?: CopilotSttRoute | null
  /** Routage/retrieval retenu — déjà calculé en pipeline, seulement persisté depuis ce lot. */
  routingDiag?: CopilotRoutingDiag | null
}

export type CopilotSttRoute = 'client_live' | 'server_stt' | 'typed'

export interface CopilotRoutingDiag {
  det: string
  merged: string
  family: string
  applied: string
  contextChars: number | null
  finishReason: string | null
}

/** Marque humaine à 3 états — remplace le pouce haut/bas jamais câblé côté UI (mig 325). */
export type CopilotAnswerQuality = 'correct' | 'incomplete' | 'incorrect'

export type CopilotCauseDiagnostic =
  | 'stt_error'
  | 'normalization_error'
  | 'routing_error'
  | 'retrieval_gap'
  | 'missing_relation'
  | 'missing_entity'
  | 'missing_data'
  | 'conflicting_data'
  | 'answer_generation_error'
  | 'other'

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
        voice_used:                   input.voiceUsed ?? false,
        audio_duration_ms:            input.audioDurationMs ?? null,
        transcription_latency_ms:     input.transcriptionLatencyMs ?? null,
        transcription_model:          input.transcriptionModel ?? null,
        transcription_tokens_audio:   input.transcriptionTokensAudio ?? null,
        transcription_tokens_output:  input.transcriptionTokensOutput ?? null,
        transcription_error:          input.transcriptionError ?? null,
        transcription_raw:            input.transcriptionRaw ?? null,
        transcription_corrections:    input.transcriptionCorrections ?? null,
        transcription_abstentions:    input.transcriptionAbstentions ?? null,
        stt_route:                    input.sttRoute ?? null,
        routing_diag:                 input.routingDiag ?? null,
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

/**
 * Enregistre le retour humain sur une réponse (correcte / incomplète /
 * incorrecte + correction ou note libre optionnelle). Brique 2 de l'audit
 * Copilote (mandat Vincent 2026-08-17). Best-effort : ne lève jamais.
 */
export async function updateCopilotAnswerQuality(
  interactionId: string,
  quality: CopilotAnswerQuality,
  comment?: string | null,
): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase
      .from('copilot_interactions')
      .update({ answer_quality: quality, feedback_comment: comment ?? null })
      .eq('id', interactionId)
  } catch {
    // best-effort
  }
}

/**
 * Classifie la cause racine d'une réponse jugée insatisfaisante. Posé par un
 * humain en recette pour l'instant — une future proposition LLM (brique 3)
 * devra passer par la même validation humaine, jamais une écriture directe.
 * Best-effort : ne lève jamais.
 */
export async function updateCopilotCauseDiagnostic(
  interactionId: string,
  cause: CopilotCauseDiagnostic,
): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase
      .from('copilot_interactions')
      .update({ cause_diagnostic: cause })
      .eq('id', interactionId)
  } catch {
    // best-effort
  }
}
