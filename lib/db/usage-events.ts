// lib/db/usage-events.ts
// Usage produit — instrumentation LÉGÈRE pour le test terrain (≠ audit sécurité,
// cf. lib/db/activity-logs.ts). Répond à 3 questions :
//   1. Quels briefs sont ouverts ?
//   2. Que cherchent les gens ?
//   3. Ouvrir un brief mène-t-il à une action réelle (≤ 10 min) ?
//
// Doctrine : best-effort total. logUsageEvent ne lève JAMAIS et ne bloque jamais
// l'appelant. Lectures bornées (N derniers jours). Dégradation gracieuse si la
// migration 113 n'est pas encore appliquée (table absente → zéros).

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile, getOrgId } from '@/lib/db/users'

/** Vrai si l'erreur indique « table usage_events absente » (migration 113 non appliquée). */
function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return code === '42P01' || msg.includes('usage_events') || msg.includes('does not exist')
}

/**
 * Trace un événement d'usage produit. BEST-EFFORT : ne lève jamais, ne bloque
 * jamais l'appelant (à appeler en `void logUsageEvent(...)` côté chaud).
 *
 * meta = { query } seulement si une query est fournie (trim, max 200 car.).
 */
export async function logUsageEvent(input: {
  event: string
  siteId?: string | null
  query?: string | null
}): Promise<void> {
  try {
    const [user, orgId] = await Promise.all([
      getCurrentUserWithProfile().catch(() => null),
      getOrgId().catch(() => null),
    ])

    const trimmed = typeof input.query === 'string' ? input.query.trim().slice(0, 200) : ''
    const meta = trimmed ? { query: trimmed } : null

    const supabase = createAdminClient()
    await supabase.from('usage_events').insert({
      event: input.event,
      site_id: input.siteId ?? null,
      user_id: user?.id ?? null,
      organization_id: orgId,
      meta,
    })
  } catch {
    // Best-effort : on avale tout (table absente, pas de session, réseau…).
  }
}

export interface UsageSummary {
  visitOpens: number
  meetingOpens: number
  searches: number
  actionsCreated: number
  topSearches: Array<{ query: string; count: number }>
  briefToActionCount: number
}

const EMPTY_SUMMARY: UsageSummary = {
  visitOpens: 0,
  meetingOpens: 0,
  searches: 0,
  actionsCreated: 0,
  topSearches: [],
  briefToActionCount: 0,
}

interface UsageRow {
  event: string
  user_id: string | null
  site_id: string | null
  meta: { query?: string | null } | null
  created_at: string
}

/** Corrélation brief → action : nombre d'action_created survenues ≤ 10 min APRÈS
 *  l'ouverture d'un brief, par le MÊME user et le MÊME site. Calcul en JS. */
function countBriefToAction(rows: UsageRow[]): number {
  const TEN_MIN = 10 * 60 * 1000
  const briefOpens = rows
    .filter((r) => r.event === 'prepare_visit_opened' || r.event === 'prepare_meeting_opened')
    .map((r) => ({ user_id: r.user_id, site_id: r.site_id, t: new Date(r.created_at).getTime() }))
    .filter((r) => !Number.isNaN(r.t))
    .sort((a, b) => a.t - b.t)

  let count = 0
  for (const a of rows) {
    if (a.event !== 'action_created') continue
    const t = new Date(a.created_at).getTime()
    if (Number.isNaN(t)) continue
    // Une ouverture de brief du même user+site, dans la fenêtre [t-10min, t].
    const matched = briefOpens.some(
      (b) =>
        b.user_id != null &&
        b.user_id === a.user_id &&
        b.site_id != null &&
        b.site_id === a.site_id &&
        b.t <= t &&
        t - b.t <= TEN_MIN,
    )
    if (matched) count++
  }
  return count
}

/**
 * Synthèse d'usage sur les `days` derniers jours. Admin client.
 * Résilient : si la table n'existe pas (migration 113 non appliquée), renvoie 0.
 */
export async function getUsageSummary(days = 7): Promise<UsageSummary> {
  try {
    const supabase = createAdminClient()
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    const { data, error } = await supabase
      .from('usage_events')
      .select('event, user_id, site_id, meta, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })

    if (error) {
      if (isMissingTableError(error)) return { ...EMPTY_SUMMARY }
      return { ...EMPTY_SUMMARY }
    }

    const rows = (data ?? []) as UsageRow[]

    let visitOpens = 0
    let meetingOpens = 0
    let searches = 0
    let actionsCreated = 0
    const searchCounts = new Map<string, number>()

    for (const r of rows) {
      switch (r.event) {
        case 'prepare_visit_opened':
          visitOpens++
          break
        case 'prepare_meeting_opened':
          meetingOpens++
          break
        case 'memory_search': {
          searches++
          const q = (r.meta?.query ?? '').toLowerCase().trim()
          if (q) searchCounts.set(q, (searchCounts.get(q) ?? 0) + 1)
          break
        }
        case 'action_created':
          actionsCreated++
          break
      }
    }

    const topSearches = [...searchCounts.entries()]
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      visitOpens,
      meetingOpens,
      searches,
      actionsCreated,
      topSearches,
      briefToActionCount: countBriefToAction(rows),
    }
  } catch {
    return { ...EMPTY_SUMMARY }
  }
}
