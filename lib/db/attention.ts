// lib/db/attention.ts
//
// « Ce qui mérite votre attention » — agrégation TRANSVERSE des détecteurs
// opérationnels déjà existants (actions en retard / anciennes, réserves ouvertes)
// sur TOUS les chantiers visibles de l'organisation. Pas « ses chantiers » (pas de
// doctrine RH/responsabilité). 100 % DÉTERMINISTE, zéro LLM, zéro score de personne.
//
// Sujet = le CHANTIER qui mérite l'attention, jamais la performance d'un acteur.
// Chaque item répond à : QUOI · POURQUOI maintenant · OÙ cliquer. Plafonné.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { listOpenSiteActions, actionHealth, type SiteActionRow } from '@/lib/db/site-actions'
import { todayLocalIso } from '@/lib/time/local-date'

export type AttentionTier = 'red' | 'orange'
export interface AttentionItem {
  tier: AttentionTier
  /** QUOI — « 2 actions en retard ». */
  what: string
  /** OÙ — nom du chantier. */
  where: string
  /** POURQUOI maintenant — « la plus en retard : « … » (+12 j) ». */
  why: string
  href: string
}
export interface AttentionDigest {
  red: AttentionItem[]
  orange: AttentionItem[]
  /** Chantiers sans aucune alerte rouge/orange (« en rythme »). */
  greenSites: number
  totalSites: number
}

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}
function trunc(s: string, n = 48): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s
}

export async function getAttentionDigest(limit = 5): Promise<AttentionDigest> {
  const sb = createAdminClient()
  const orgId = await getOrgId().catch(() => null)

  let sitesQ = sb.from('sites').select('id, name').is('deleted_at', null)
  if (orgId) sitesQ = sitesQ.eq('organization_id', orgId)
  const { data: siteRows } = await sitesQ
  const sites = (siteRows ?? []) as Array<{ id: string; name: string }>
  const totalSites = sites.length
  if (totalSites === 0) return { red: [], orange: [], greenSites: 0, totalSites: 0 }

  const siteIds = sites.map((s) => s.id)
  const nameOf = new Map(sites.map((s) => [s.id, s.name]))
  const today = todayLocalIso()

  const [actions, reservesRes] = await Promise.all([
    listOpenSiteActions({ siteIds }).catch(() => [] as SiteActionRow[]),
    sb.from('site_reserve').select('site_id, label, created_at').in('site_id', siteIds).eq('status', 'open'),
  ])

  type Agg = { overdue: SiteActionRow[]; oldOpen: SiteActionRow[]; reserves: Array<{ created_at: string }> }
  const agg = new Map<string, Agg>()
  const get = (id: string): Agg => {
    let a = agg.get(id); if (!a) { a = { overdue: [], oldOpen: [], reserves: [] }; agg.set(id, a) } return a
  }
  for (const a of actions) {
    if (a.due_date && a.due_date < today) get(a.site_id).overdue.push(a)
    else if (actionHealth(a.created_at) === 'critique') get(a.site_id).oldOpen.push(a)
  }
  for (const r of (reservesRes.data ?? []) as Array<{ site_id: string; created_at: string }>) get(r.site_id).reserves.push(r)

  const red: AttentionItem[] = []
  const orange: AttentionItem[] = []
  const flagged = new Set<string>()

  for (const [siteId, a] of agg) {
    const where = nameOf.get(siteId) ?? '—'

    // 🔴 Actions en retard.
    if (a.overdue.length > 0) {
      flagged.add(siteId)
      const oldest = a.overdue.reduce((o, x) => ((x.due_date ?? '') < (o.due_date ?? '') ? x : o))
      const late = oldest.due_date ? ageDays(oldest.due_date) : 0
      red.push({
        tier: 'red',
        what: `${a.overdue.length} action${a.overdue.length > 1 ? 's' : ''} en retard`,
        where,
        why: `la plus en retard : « ${trunc(oldest.title)} » (+${late} j)`,
        href: `/sites/${siteId}/actions`,
      })
    }

    // Réserves ouvertes → 🔴 si la plus ancienne ≥ 30 j, sinon 🟠.
    if (a.reserves.length > 0) {
      flagged.add(siteId)
      const oldest = a.reserves.reduce((o, x) => (x.created_at < o.created_at ? x : o))
      const age = ageDays(oldest.created_at)
      const item: AttentionItem = {
        tier: age >= 30 ? 'red' : 'orange',
        what: `${a.reserves.length} réserve${a.reserves.length > 1 ? 's' : ''} ouverte${a.reserves.length > 1 ? 's' : ''}`,
        where,
        why: `la plus ancienne depuis ${age} j`,
        href: `/sites/${siteId}/reserves`,
      }
      ;(item.tier === 'red' ? red : orange).push(item)
    }

    // 🟠 Actions anciennes (pas encore en retard mais qui traînent).
    if (a.oldOpen.length > 0) {
      flagged.add(siteId)
      const oldest = a.oldOpen.reduce((o, x) => (x.created_at < o.created_at ? x : o))
      orange.push({
        tier: 'orange',
        what: `${a.oldOpen.length} action${a.oldOpen.length > 1 ? 's' : ''} ancienne${a.oldOpen.length > 1 ? 's' : ''}`,
        where,
        why: `ouverte depuis ${ageDays(oldest.created_at)} j`,
        href: `/sites/${siteId}/actions`,
      })
    }
  }

  // Plafond : rouge d'abord, puis orange, total = limit.
  const cappedRed = red.slice(0, limit)
  const cappedOrange = orange.slice(0, Math.max(0, limit - cappedRed.length))
  return { red: cappedRed, orange: cappedOrange, greenSites: totalSites - flagged.size, totalSites }
}
