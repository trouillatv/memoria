import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { deriveSiteAttentionItems, type SiteAttentionItem, type AttentionUrgency } from './site-attention-items'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import { getSiteSubjectMatrix } from '@/lib/documents/pv-history'
import { computeWatchlist } from '@/lib/documents/pv-watchlist'

export interface VisitBriefingDelta {
  since: string
  subjectsChanged: number
  actionsCreated: number
  actionsClosed: number
  reservesCreated: number
  reservesLifted: number
}

export interface VisitBriefing {
  attention: SiteAttentionItem[]
  delta: VisitBriefingDelta | null
  watchlistOpenCount: number
}

// ─── Ranking ─────────────────────────────────────────────────────────────────

const URGENCY_RANK: Record<AttentionUrgency, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

// Prend un sous-ensemble diversifié en évitant de saturer avec le même signal.
// Premier tour : un seul item par signal. Deuxième tour : on remplit jusqu'au quota.
function diversify(items: SiteAttentionItem[], quota: number): SiteAttentionItem[] {
  if (items.length === 0 || quota <= 0) return []
  const seen = new Set<string>()
  const firstPass: SiteAttentionItem[] = []
  const overflow: SiteAttentionItem[] = []
  for (const item of items) {
    if (!seen.has(item.signal)) {
      firstPass.push(item)
      seen.add(item.signal)
    } else {
      overflow.push(item)
    }
  }
  return [...firstPass, ...overflow].slice(0, quota)
}

/**
 * Sélectionne au plus `max` items pour le briefing de visite.
 * Règles :
 *  – low écarté systématiquement (informatif, non actionnable avant visite).
 *  – critical : tous, dans l'ordre.
 *  – high puis medium : diversification par signal (un de chaque en premier).
 *  – jamais de dépassement du cap global.
 */
export function rankBriefingAttention(
  items: SiteAttentionItem[],
  max = 6,
): SiteAttentionItem[] {
  const eligible = items.filter(i => i.urgency !== 'low')
  if (eligible.length === 0) return []

  const criticals = eligible.filter(i => i.urgency === 'critical')
  const highs     = eligible.filter(i => i.urgency === 'high')
  const mediums   = eligible.filter(i => i.urgency === 'medium')

  const result: SiteAttentionItem[] = [...criticals]
  if (result.length < max) result.push(...diversify(highs, max - result.length))
  if (result.length < max) result.push(...diversify(mediums, max - result.length))

  return result.slice(0, max)
}

// ─── Assembleur ───────────────────────────────────────────────────────────────

export async function buildVisitBriefing(siteId: string): Promise<VisitBriefing> {
  const admin = createAdminClient()

  // Phase 1 — tout en parallèle.
  // NB : getNavigableSubjectsForSite est aussi appelé en interne par
  // deriveSiteAttentionItems. La redondance est acceptée : les deux requêtes
  // partent en parallèle (pas d'impact latence) et garantissent que
  // subjectsChanged est calculé par rapport à lastVisitAt terrain, pas import.
  const [allItems, terrainResult, matrix, subjects] = await Promise.all([
    deriveSiteAttentionItems(siteId),
    admin
      .from('site_reports')
      .select('ended_at')
      .eq('site_id', siteId)
      .or('origin.neq.import,origin.is.null')
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(1),
    getSiteSubjectMatrix(siteId).catch(() => null),
    getNavigableSubjectsForSite(siteId).catch(() => []),
  ])

  const lastVisitAt = (terrainResult.data?.[0]?.ended_at as string | undefined) ?? null
  const watchlistOpenCount = matrix ? computeWatchlist(matrix).length : 0

  // Phase 2 — delta (seulement si une visite terrain existe).
  let delta: VisitBriefingDelta | null = null
  if (lastVisitAt) {
    const [created, closed, rCreated, rLifted] = await Promise.all([
      admin
        .from('site_actions')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', siteId)
        .gt('created_at', lastVisitAt),
      admin
        .from('site_actions')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', siteId)
        .not('done_at', 'is', null)
        .gt('done_at', lastVisitAt),
      admin
        .from('site_reserve')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', siteId)
        .gt('issued_on', lastVisitAt),
      admin
        .from('site_reserve')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', siteId)
        .not('lifted_at', 'is', null)
        .gt('lifted_at', lastVisitAt),
    ])

    const subjectsChanged = subjects.filter(
      s => s.lastMeaningfulChangeAt && s.lastMeaningfulChangeAt > lastVisitAt,
    ).length

    const d: VisitBriefingDelta = {
      since: lastVisitAt,
      subjectsChanged,
      actionsCreated:  created.count  ?? 0,
      actionsClosed:   closed.count   ?? 0,
      reservesCreated: rCreated.count ?? 0,
      reservesLifted:  rLifted.count  ?? 0,
    }

    const hasActivity =
      d.subjectsChanged + d.actionsCreated + d.actionsClosed +
      d.reservesCreated + d.reservesLifted > 0
    delta = hasActivity ? d : null
  }

  return {
    attention: rankBriefingAttention(allItems),
    delta,
    watchlistOpenCount,
  }
}
