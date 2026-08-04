// lib/db/copilot-interactions-read.ts
// Lecture admin de copilot_interactions (mig 294).
// Toutes les fonctions passent par createAdminClient() — accès admin uniquement.
// Les questions et réponses complètes ne sont exposées que dans le drawer.

import { createAdminClient } from '@/lib/supabase/admin'
import type { CopilotScope, CopilotAnswerMode, CopilotAnswerStatus } from './copilot-telemetry'

// ── Types publics ─────────────────────────────────────────────────────────────

export type CopilotInteractionRow = {
  id: string
  organizationId: string
  siteId: string | null
  siteName: string | null
  userId: string | null
  userEmail: string | null
  conversationId: string | null
  createdAt: string
  question: string             // extrait 150 chars max dans les listes
  conversationMode: 'guided' | 'free'
  guidedIntent: string | null
  primaryIntent: string | null
  scope: CopilotScope
  answerMode: CopilotAnswerMode | null
  answerStatus: CopilotAnswerStatus | null
  citedReferenceCount: number
  latencyMs: number | null
  usedFallback: boolean
  proposalKind: 'action' | 'visit_item' | null
  proposalStatus: 'none' | 'shown' | 'confirmed' | 'cancelled'
  referenceClicks: number
}

export type CopilotInteractionDetail = CopilotInteractionRow & {
  answerText: string | null     // complet — drawer uniquement
  secondaryIntents: string[]
  resolvedSubjectIds: string[]
  sourcesUsed: string[]
  model: string | null
  promptVersion: string | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostEur: number | null
  proposalId: string | null
}

export type CopilotStats = {
  totalInteractions: number
  uniqueUsers: number
  uniqueSites: number
  llmRate: number            // % réponses LLM
  fallbackRate: number       // % fallback déterministe
  notFoundRate: number       // % not_found
  clarificationRate: number  // % clarification
  proposalsShown: number
  proposalsConfirmed: number
  proposalsCancelled: number
  totalReferenceClicks: number
  medianLatencyMs: number | null
  p95LatencyMs: number | null
  totalInputTokens: number
  totalOutputTokens: number
  estimatedTotalCostEur: number
}

export type CopilotScopeBreakdown = {
  scope: string
  count: number
  pct: number
}

export type CopilotListFilters = {
  days?: number           // défaut 30
  siteId?: string | null
  scope?: string | null
  answerStatus?: string | null
  answerMode?: string | null
  proposalOnly?: boolean
  search?: string | null  // recherche dans question (ILIKE)
  limit?: number          // défaut 50
  offset?: number         // défaut 0
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fromIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString()
}

// ── Statistiques globales ─────────────────────────────────────────────────────

export async function getCopilotStats(days = 30): Promise<CopilotStats> {
  const supabase = createAdminClient()
  const since = fromIso(days)

  const { data, error } = await supabase
    .from('copilot_interactions')
    .select(
      'id, user_id, site_id, answer_mode, answer_status, used_fallback, ' +
      'proposal_kind, proposal_status, reference_clicks, ' +
      'latency_ms, input_tokens, output_tokens, estimated_cost_eur',
    )
    .gte('created_at', since)

  if (error || !data) {
    return {
      totalInteractions: 0, uniqueUsers: 0, uniqueSites: 0,
      llmRate: 0, fallbackRate: 0, notFoundRate: 0, clarificationRate: 0,
      proposalsShown: 0, proposalsConfirmed: 0, proposalsCancelled: 0,
      totalReferenceClicks: 0, medianLatencyMs: null, p95LatencyMs: null,
      totalInputTokens: 0, totalOutputTokens: 0, estimatedTotalCostEur: 0,
    }
  }

  const rows = data as unknown as Array<Record<string, unknown>>
  const n = rows.length

  const users = new Set(rows.map((r) => r.user_id).filter(Boolean))
  const sites = new Set(rows.map((r) => r.site_id).filter(Boolean))

  const llm    = rows.filter((r) => r.answer_mode === 'llm').length
  const fallb  = rows.filter((r) => r.answer_mode === 'deterministic_fallback').length
  const clarif = rows.filter((r) => r.answer_mode === 'clarification').length
  const nf     = rows.filter((r) => r.answer_status === 'not_found').length
  const pShown = rows.filter((r) => r.proposal_kind !== null).length
  const pConf  = rows.filter((r) => r.proposal_status === 'confirmed').length
  const pCanc  = rows.filter((r) => r.proposal_status === 'cancelled').length
  const refClicks = rows.reduce((s, r) => s + ((r.reference_clicks as number) || 0), 0)
  const inputTok  = rows.reduce((s, r) => s + ((r.input_tokens as number) || 0), 0)
  const outputTok = rows.reduce((s, r) => s + ((r.output_tokens as number) || 0), 0)
  const costEur   = rows.reduce((s, r) => s + ((r.estimated_cost_eur as number) || 0), 0)

  const latencies = rows
    .map((r) => r.latency_ms as number)
    .filter((v) => typeof v === 'number' && v > 0)
    .sort((a, b) => a - b)
  const medianLatencyMs = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null
  const p95LatencyMs    = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : null

  return {
    totalInteractions:    n,
    uniqueUsers:          users.size,
    uniqueSites:          sites.size,
    llmRate:              n ? Math.round((llm / n) * 100) : 0,
    fallbackRate:         n ? Math.round((fallb / n) * 100) : 0,
    notFoundRate:         n ? Math.round((nf / n) * 100) : 0,
    clarificationRate:    n ? Math.round((clarif / n) * 100) : 0,
    proposalsShown:       pShown,
    proposalsConfirmed:   pConf,
    proposalsCancelled:   pCanc,
    totalReferenceClicks: refClicks,
    medianLatencyMs,
    p95LatencyMs,
    totalInputTokens:     inputTok,
    totalOutputTokens:    outputTok,
    estimatedTotalCostEur: Math.round(costEur * 1000) / 1000,
  }
}

// ── Répartition par scope ─────────────────────────────────────────────────────

export async function getCopilotScopeBreakdown(days = 30): Promise<CopilotScopeBreakdown[]> {
  const supabase = createAdminClient()
  const since = fromIso(days)

  const { data } = await supabase
    .from('copilot_interactions')
    .select('scope')
    .gte('created_at', since)

  if (!data) return []

  const counts: Record<string, number> = {}
  for (const row of data as Array<{ scope: string }>) {
    counts[row.scope] = (counts[row.scope] ?? 0) + 1
  }
  const total = Object.values(counts).reduce((s, c) => s + c, 0)
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([scope, count]) => ({
      scope,
      count,
      pct: total ? Math.round((count / total) * 100) : 0,
    }))
}

// ── Journal filtré ────────────────────────────────────────────────────────────

export async function listCopilotInteractions(
  filters: CopilotListFilters = {},
): Promise<{ rows: CopilotInteractionRow[]; total: number }> {
  const supabase = createAdminClient()
  const since = fromIso(filters.days ?? 30)
  const limit  = Math.min(filters.limit ?? 50, 200)
  const offset = filters.offset ?? 0

  // Jointure légère via sous-requête (PostgREST ne supporte pas JOIN sur tables externes)
  // On charge site et user séparément pour garder la requête simple.
  let q = supabase
    .from('copilot_interactions')
    .select(
      'id, organization_id, site_id, user_id, conversation_id, created_at, ' +
      'question, conversation_mode, guided_intent, primary_intent, scope, ' +
      'answer_mode, answer_status, cited_reference_count, latency_ms, used_fallback, ' +
      'proposal_kind, proposal_status, reference_clicks',
      { count: 'exact' },
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filters.siteId) q = q.eq('site_id', filters.siteId)
  if (filters.scope)  q = q.eq('scope', filters.scope)
  if (filters.answerStatus) q = q.eq('answer_status', filters.answerStatus)
  if (filters.answerMode)   q = q.eq('answer_mode', filters.answerMode)
  if (filters.proposalOnly) q = q.not('proposal_kind', 'is', null)
  if (filters.search) q = q.ilike('question', `%${filters.search}%`)

  const { data, count, error } = await q
  if (error || !data) return { rows: [], total: 0 }

  // Enrichir avec noms de sites (batch lookup)
  const rawRows = data as unknown as Array<Record<string, unknown>>
  const siteIds = [...new Set(rawRows.map((r) => r.site_id).filter(Boolean))]
  const siteNames: Record<string, string> = {}
  if (siteIds.length > 0) {
    const { data: sites } = await supabase
      .from('sites')
      .select('id, name')
      .in('id', siteIds as string[])
    for (const s of (sites ?? []) as Array<{ id: string; name: string }>) {
      siteNames[s.id] = s.name
    }
  }

  // Enrichir avec emails (batch lookup)
  const userIds = [...new Set(rawRows.map((r) => r.user_id).filter(Boolean))]
  const userEmails: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, email')
      .in('id', userIds as string[])
    for (const u of (users ?? []) as Array<{ id: string; email: string }>) {
      userEmails[u.id] = u.email
    }
  }

  const rows: CopilotInteractionRow[] = (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    id:                   r.id as string,
    organizationId:       r.organization_id as string,
    siteId:               r.site_id as string | null,
    siteName:             r.site_id ? (siteNames[r.site_id as string] ?? null) : null,
    userId:               r.user_id as string | null,
    userEmail:            r.user_id ? (userEmails[r.user_id as string] ?? null) : null,
    conversationId:       r.conversation_id as string | null,
    createdAt:            r.created_at as string,
    question:             ((r.question as string) ?? '').slice(0, 150),
    conversationMode:     r.conversation_mode as 'guided' | 'free',
    guidedIntent:         r.guided_intent as string | null,
    primaryIntent:        r.primary_intent as string | null,
    scope:                (r.scope as CopilotScope) ?? 'unknown',
    answerMode:           r.answer_mode as CopilotAnswerMode | null,
    answerStatus:         r.answer_status as CopilotAnswerStatus | null,
    citedReferenceCount:  (r.cited_reference_count as number) ?? 0,
    latencyMs:            r.latency_ms as number | null,
    usedFallback:         !!r.used_fallback,
    proposalKind:         r.proposal_kind as 'action' | 'visit_item' | null,
    proposalStatus:       (r.proposal_status as 'none' | 'shown' | 'confirmed' | 'cancelled') ?? 'none',
    referenceClicks:      (r.reference_clicks as number) ?? 0,
  }))

  return { rows, total: count ?? 0 }
}

// ── Détail d'une interaction (drawer) ─────────────────────────────────────────

export async function getCopilotInteractionDetail(
  id: string,
): Promise<CopilotInteractionDetail | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('copilot_interactions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return null
  const r = data as Record<string, unknown>

  // Site
  let siteName: string | null = null
  if (r.site_id) {
    const { data: s } = await supabase.from('sites').select('name').eq('id', r.site_id).single()
    siteName = (s as { name: string } | null)?.name ?? null
  }

  // User
  let userEmail: string | null = null
  if (r.user_id) {
    const { data: u } = await supabase.from('users').select('email').eq('id', r.user_id).single()
    userEmail = (u as { email: string } | null)?.email ?? null
  }

  return {
    id:                   r.id as string,
    organizationId:       r.organization_id as string,
    siteId:               r.site_id as string | null,
    siteName,
    userId:               r.user_id as string | null,
    userEmail,
    conversationId:       r.conversation_id as string | null,
    createdAt:            r.created_at as string,
    question:             r.question as string,
    conversationMode:     r.conversation_mode as 'guided' | 'free',
    guidedIntent:         r.guided_intent as string | null,
    primaryIntent:        r.primary_intent as string | null,
    secondaryIntents:     (r.secondary_intents as string[]) ?? [],
    scope:                (r.scope as CopilotScope) ?? 'unknown',
    resolvedSubjectIds:   (r.resolved_subject_ids as string[]) ?? [],
    answerText:           r.answer_text as string | null,
    answerMode:           r.answer_mode as CopilotAnswerMode | null,
    answerStatus:         r.answer_status as CopilotAnswerStatus | null,
    citedReferenceCount:  (r.cited_reference_count as number) ?? 0,
    sourcesUsed:          (r.sources_used as string[]) ?? [],
    latencyMs:            r.latency_ms as number | null,
    usedFallback:         !!r.used_fallback,
    model:                r.model as string | null,
    promptVersion:        r.prompt_version as string | null,
    inputTokens:          r.input_tokens as number | null,
    outputTokens:         r.output_tokens as number | null,
    estimatedCostEur:     r.estimated_cost_eur as number | null,
    proposalKind:         r.proposal_kind as 'action' | 'visit_item' | null,
    proposalId:           r.proposal_id as string | null,
    proposalStatus:       (r.proposal_status as 'none' | 'shown' | 'confirmed' | 'cancelled') ?? 'none',
    referenceClicks:      (r.reference_clicks as number) ?? 0,
  }
}

// ── Questions les plus fréquentes ─────────────────────────────────────────────

export async function getTopCopilotQuestions(
  days = 30,
  limit = 20,
): Promise<Array<{ question: string; count: number }>> {
  const supabase = createAdminClient()
  const since = fromIso(days)

  const { data } = await supabase
    .from('copilot_interactions')
    .select('question')
    .gte('created_at', since)
    .eq('conversation_mode', 'free')

  if (!data) return []

  const counts: Record<string, number> = {}
  for (const { question } of data as Array<{ question: string }>) {
    const key = question.trim().toLowerCase().slice(0, 120)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([question, count]) => ({ question, count }))
}
