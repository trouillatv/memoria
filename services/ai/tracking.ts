import { createAdminClient } from '@/lib/supabase/admin'
import type { AIProviderName } from './index'

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
      cost_usd: null,
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
