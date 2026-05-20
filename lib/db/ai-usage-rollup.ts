import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

// Helpers de requête sur ai_usage pour la console admin /admin/ai-monitoring.
// Pure SQL côté serveur — ZÉRO appel IA pour observer l'IA. Doctrine.

export interface AIUsageByFeatureRow {
  feature: string
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  errors: number
  lastCallAt: string | null
  lastModel: string | null
  lastProvider: string | null
}

/** Agrégat par feature sur les N derniers jours.
 *  Retourne une ligne par feature, triée par appels DESC. */
export async function getAIUsageByFeature(days: number = 7): Promise<AIUsageByFeatureRow[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('ai_usage')
    .select('feature, input_tokens, output_tokens, cost_usd, status, created_at, model, provider')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  const map = new Map<string, AIUsageByFeatureRow>()
  for (const row of (data ?? []) as Array<{
    feature: string
    input_tokens: number | null
    output_tokens: number | null
    cost_usd: number | null
    status: string
    created_at: string
    model: string | null
    provider: string | null
  }>) {
    const r = map.get(row.feature) ?? {
      feature: row.feature,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      errors: 0,
      lastCallAt: null,
      lastModel: null,
      lastProvider: null,
    }
    r.calls += 1
    r.inputTokens += row.input_tokens ?? 0
    r.outputTokens += row.output_tokens ?? 0
    r.costUsd += row.cost_usd ?? 0
    if (row.status === 'error') r.errors += 1
    if (!r.lastCallAt || row.created_at > r.lastCallAt) {
      r.lastCallAt = row.created_at
      r.lastModel = row.model
      r.lastProvider = row.provider
    }
    map.set(row.feature, r)
  }
  return Array.from(map.values()).sort((a, b) => b.calls - a.calls)
}

export interface AIUsageRecentCall {
  id: string
  createdAt: string
  feature: string
  model: string | null
  provider: string | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  durationMs: number | null
  status: string
  errorMsg: string | null
}

/** Les N derniers appels IA, triés par date DESC. Pour la section
 *  « activité récente » de la console admin. */
export async function getRecentAICalls(limit: number = 50): Promise<AIUsageRecentCall[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('ai_usage')
    .select('id, created_at, feature, model, provider, input_tokens, output_tokens, cost_usd, duration_ms, status, error_msg')
    .order('created_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    feature: r.feature as string,
    model: r.model as string | null,
    provider: r.provider as string | null,
    inputTokens: r.input_tokens as number | null,
    outputTokens: r.output_tokens as number | null,
    costUsd: r.cost_usd as number | null,
    durationMs: r.duration_ms as number | null,
    status: r.status as string,
    errorMsg: r.error_msg as string | null,
  }))
}

export interface AIProductionSummary {
  resonancesActiveB1: number
  resonancesActiveB2: number
  resonancesStaledRecent: number
  resonancesDismissedRecent: number
  documentsReadyRecent: number
  documentsFailedRecent: number
}

/** Production récente — sources DB pures (pas ai_usage). Compte les
 *  artefacts produits par l'IA dans les N derniers jours, par catégorie.
 *  Doctrine : seulement des comptes descriptifs, jamais de score qualité. */
export async function getAIProductionSummary(days: number = 7): Promise<AIProductionSummary> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const supabase = createAdminClient()

  // Résonances B1/B2 par status
  const { data: rows } = await supabase
    .from('site_reading_candidates')
    .select('algorithm_version, status, generated_at')
    .like('algorithm_version', 'b%_doc_%')
    .gte('generated_at', since)

  let b1Active = 0, b2Active = 0, staled = 0, dismissed = 0
  for (const r of (rows ?? []) as Array<{ algorithm_version: string; status: string }>) {
    if (r.status === 'active') {
      if (r.algorithm_version.startsWith('b1_doc_')) b1Active += 1
      else if (r.algorithm_version.startsWith('b2_doc_')) b2Active += 1
    } else if (r.status === 'stale') staled += 1
    else if (r.status === 'dismissed') dismissed += 1
  }

  // Documents analysés (status final)
  const { data: docs } = await supabase
    .from('documents')
    .select('analysis_status, updated_at')
    .gte('updated_at', since)
    .is('deleted_at', null)
  let docsReady = 0, docsFailed = 0
  for (const d of (docs ?? []) as Array<{ analysis_status: string }>) {
    if (d.analysis_status === 'ready') docsReady += 1
    else if (d.analysis_status === 'failed') docsFailed += 1
  }

  return {
    resonancesActiveB1: b1Active,
    resonancesActiveB2: b2Active,
    resonancesStaledRecent: staled,
    resonancesDismissedRecent: dismissed,
    documentsReadyRecent: docsReady,
    documentsFailedRecent: docsFailed,
  }
}
