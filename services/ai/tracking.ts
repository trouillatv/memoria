import { createAdminClient } from '@/lib/supabase/admin'
import type { AIProviderName } from './index'

// ============================================================================
// Table de prix par modèle (USD per 1M tokens). Source : pages tarifaires
// officielles Google / Anthropic / OpenAI au 2026-05-20. À mettre à jour
// manuellement lors d'un changement de pricing fournisseur. Pas de live
// pricing — déterministe et explicable.
// ============================================================================

export const AI_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Google Gemini
  'gemini-embedding-001':       { input: 0.025, output: 0 },
  'gemini-2.5-flash':           { input: 0.075, output: 0.30 },
  'gemini-2.0-flash':           { input: 0.075, output: 0.30 },
  'gemini-2.5-pro':             { input: 1.25,  output: 5.00 },
  // Anthropic
  'claude-haiku-4-5-20251001':  { input: 1.00,  output: 5.00 },
  'claude-opus-4-7':            { input: 15.0,  output: 75.0 },
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.0 },
  // OpenAI (fallback)
  'text-embedding-3-small':     { input: 0.02,  output: 0 },
  // Legacy / deprecated — gardé pour audit historique mais pricing 0
  'text-embedding-004':         { input: 0,     output: 0 },
}

/** Estimation déterministe du coût d'un appel IA, basé sur la table de prix
 *  ci-dessus. Retourne null si le modèle est inconnu (pour ne pas mentir
 *  par 0). Précision 6 décimales (suffisant pour additionner sur un mois). */
export function estimateCostUsd(
  model: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  if (!model) return null
  const pricing = AI_MODEL_PRICING[model]
  if (!pricing) return null
  const inputCost = ((inputTokens ?? 0) / 1_000_000) * pricing.input
  const outputCost = ((outputTokens ?? 0) / 1_000_000) * pricing.output
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
}

export interface AIUsageEntry {
  user_id: string | null
  feature: string
  provider: AIProviderName
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  duration_ms: number | null
  status: 'success' | 'error'
  error_msg: string | null
}

export async function logAIUsage(entry: AIUsageEntry): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('ai_usage').insert(entry)
    if (error) console.warn('[ai-usage] insert failed:', error.message)
  } catch (e) {
    console.warn('[ai-usage] exception:', e)
  }
}

/** Logger léger pour les call-sites IA qui N'utilisent PAS withAITracking
 *  (embeddings batches, OCR, photo analysis). Calcule cost_usd
 *  automatiquement via la table de prix. Silencieux : ne casse jamais
 *  l'appel IA si le log échoue. */
export async function logAIUsageDirect(params: {
  feature: string
  userId: string | null
  provider: AIProviderName
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  durationMs: number | null
  status: 'success' | 'error'
  errorMsg: string | null
}): Promise<void> {
  await logAIUsage({
    user_id: params.userId,
    feature: params.feature,
    provider: params.provider,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd: estimateCostUsd(params.model, params.inputTokens, params.outputTokens),
    duration_ms: params.durationMs,
    status: params.status,
    error_msg: params.errorMsg,
  })
}

export async function withAITracking<T>(
  feature: string,
  userId: string | null,
  fn: () => Promise<{ result: T; tokens: { input: number; output: number }; model: string; provider: AIProviderName; durationMs?: number }>
): Promise<T> {
  const start = Date.now()
  try {
    const r = await fn()
    const durationMs = Date.now() - start  // measure here, not from callback
    await logAIUsage({
      user_id: userId,
      feature,
      provider: r.provider,
      model: r.model,
      input_tokens: r.tokens.input,
      output_tokens: r.tokens.output,
      cost_usd: estimateCostUsd(r.model, r.tokens.input, r.tokens.output),
      duration_ms: durationMs,
      status: 'success',
      error_msg: null,
    })
    return r.result
  } catch (e) {
    await logAIUsage({
      user_id: userId,
      feature,
      provider: 'mock',
      model: null,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      duration_ms: Date.now() - start,
      status: 'error',
      error_msg: e instanceof Error ? e.message : String(e),
    })
    throw e
  }
}
