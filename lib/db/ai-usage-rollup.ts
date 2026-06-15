import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

// Helpers de requête sur ai_usage pour la console admin /admin/depenses-ia.
// Pure SQL côté serveur — ZÉRO appel IA pour observer l'IA. Doctrine.
//
// Vue GLOBALE (admin only) : ces agrégats NE filtrent PAS par organisation.
// L'admin est l'opérateur plateforme : il supervise le coût IA de TOUTES les
// entreprises (et les lignes historiques ont organization_id=NULL). Filtrer
// par l'org de l'admin masquait tout (bug « Dépenses IA vide » 2026-06-15).

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

export interface AIUsageHeadline {
  /** Nombre total d'appels IA sur la période. */
  totalCalls: number
  /** Nombre d'appels en status='error'. */
  totalErrors: number
  /** Coût USD agrégé sur la période (somme cost_usd). */
  totalCostUsd: number
  /** Tokens d'entrée cumulés sur la période (somme input_tokens). */
  totalInputTokens: number
  /** Tokens de sortie cumulés sur la période (somme output_tokens). */
  totalOutputTokens: number
  /** Période en jours sur laquelle l'agrégat porte. */
  days: number
}

/** Résumé chiffré global : nombres pour la lecture rapide
 *  (appels / erreurs / coût / tokens / production — la production étant
 *  calculée séparément via getAIProductionSummary).
 *  Vincent 2026-05-21 : tokens ajoutés en headline (avant cachés dans
 *  le `<details>` collapsé des 50 derniers appels). */
export async function getAIUsageHeadline(days: number = 7): Promise<AIUsageHeadline> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('ai_usage')
    .select('status, cost_usd, input_tokens, output_tokens')
    .gte('created_at', since)
  let totalCalls = 0, totalErrors = 0, totalCostUsd = 0
  let totalInputTokens = 0, totalOutputTokens = 0
  type Row = {
    status: string
    cost_usd: number | null
    input_tokens: number | null
    output_tokens: number | null
  }
  for (const r of (data ?? []) as Row[]) {
    totalCalls += 1
    if (r.status === 'error') totalErrors += 1
    totalCostUsd += r.cost_usd ?? 0
    totalInputTokens += r.input_tokens ?? 0
    totalOutputTokens += r.output_tokens ?? 0
  }
  return {
    totalCalls,
    totalErrors,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    days,
  }
}

export interface AIModelInfo {
  provider: string
  model: string
  calls: number
  lastCallAt: string
}

/** Liste des modèles IA actifs sur la période (déduplication par
 *  provider+model). Pour le bloc "IA utilisées". Filtre les modèles
 *  null/unknown pour ne pas polluer la liste. */
export async function getAIModelsActive(days: number = 7): Promise<AIModelInfo[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('ai_usage')
    .select('provider, model, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  const map = new Map<string, AIModelInfo>()
  for (const r of (data ?? []) as Array<{ provider: string; model: string | null; created_at: string }>) {
    if (!r.model || r.model === 'unknown') continue
    const key = `${r.provider}::${r.model}`
    const existing = map.get(key)
    if (existing) {
      existing.calls += 1
    } else {
      map.set(key, {
        provider: r.provider,
        model: r.model,
        calls: 1,
        lastCallAt: r.created_at,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.calls - a.calls)
}

/** Les N dernières erreurs IA, triées DESC. Pour le bloc « erreurs récentes ». */
export async function getAIRecentErrors(limit: number = 5): Promise<AIUsageRecentCall[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('ai_usage')
    .select('id, created_at, feature, model, provider, input_tokens, output_tokens, cost_usd, duration_ms, status, error_msg')
    .eq('status', 'error')
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

export interface AIHealthSummary {
  /** OK si ≥1 appel success sur 24h, error si seulement des errors, inactif sinon. */
  embeddings:  'ok' | 'error' | 'inactif'
  ocr:         'ok' | 'error' | 'inactif'
  agentsAO:    'ok' | 'error' | 'inactif'
  /** Métadonnées : compte d'appels et d'erreurs par catégorie (24h). */
  counts: {
    embeddings:  { calls: number; errors: number }
    ocr:         { calls: number; errors: number }
    agentsAO:    { calls: number; errors: number }
  }
}

/** Santé synthétique des 3 grandes catégories d'IA. Lecture sur les
 *  dernières 24h (fenêtre courte pour refléter l'état actuel, pas une
 *  moyenne lissée). */
export async function getAIHealthSummary(): Promise<AIHealthSummary> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('ai_usage')
    .select('feature, status')
    .gte('created_at', since)

  const counts = {
    embeddings: { calls: 0, errors: 0 },
    ocr:        { calls: 0, errors: 0 },
    agentsAO:   { calls: 0, errors: 0 },
  }
  for (const r of (data ?? []) as Array<{ feature: string; status: string }>) {
    let cat: keyof typeof counts | null = null
    if (r.feature.startsWith('embed_')) cat = 'embeddings'
    else if (r.feature === 'ocr_pdf') cat = 'ocr'
    else if (['lecteur_ao', 'memoire_technique', 'conformite', 'contradicteur', 'financier', 'terrain', 'opportunity_scorer'].includes(r.feature)) cat = 'agentsAO'
    if (!cat) continue
    counts[cat].calls += 1
    if (r.status === 'error') counts[cat].errors += 1
  }

  function statusOf(c: { calls: number; errors: number }): 'ok' | 'error' | 'inactif' {
    if (c.calls === 0) return 'inactif'
    if (c.errors === c.calls) return 'error'
    return 'ok'
  }

  return {
    embeddings: statusOf(counts.embeddings),
    ocr:        statusOf(counts.ocr),
    agentsAO:   statusOf(counts.agentsAO),
    counts,
  }
}

export interface AvgCostSample {
  /** Coût USD moyen par opération sur l'échantillon, null si aucun historique. */
  avgUsd: number | null
  /** Nombre d'opérations réussies prises dans la moyenne. */
  count: number
}

/** Coût moyen OBSERVÉ des N dernières opérations IA réussies pour un ou
 *  plusieurs `feature` donnés. Sert à afficher à l'utilisateur « ce type
 *  d'action coûte en moyenne X » AVANT qu'il clique — basé sur le réel, pas
 *  sur une estimation théorique. Vincent 2026-05-27. */
export async function getAverageCostForFeatures(
  features: string[],
  sample: number = 20,
): Promise<AvgCostSample> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('ai_usage')
    .select('cost_usd')
    .in('feature', features)
    .eq('status', 'success')
    .not('cost_usd', 'is', null)
    .order('created_at', { ascending: false })
    .limit(sample)
  const rows = (data ?? []) as Array<{ cost_usd: number | null }>
  if (rows.length === 0) return { avgUsd: null, count: 0 }
  const sum = rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  return { avgUsd: sum / rows.length, count: rows.length }
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
