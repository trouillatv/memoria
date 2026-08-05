// lib/db/site-visit-brief.ts
// « Si vous revenez aujourd'hui » — sélection déterministe des éléments ouverts
// qui justifient une attention immédiate sur site.
//
// Trois sources par ordre de priorité d'affichage :
//   1. Actions en retard   : due_date < aujourd'hui, statut open/planned
//   2. Réserves vieillissantes : statut open, plus ancienne d'abord
//   3. Échéances imminentes : due_date ≤ J+7, statut to_plan/planned
//
// Résultat : 4 items max + compteur de débordement. Null si rien.
// Doctrine : une ligne = un objet réel avec un contexte temporel lisible.

import { createAdminClient } from '@/lib/supabase/admin'

export type BriefItemKind = 'action_overdue' | 'reserve_aging' | 'deadline_soon'

export interface BriefItem {
  kind: BriefItemKind
  label: string
  /** Contexte temporel : « 12 j de retard » / « ouverte depuis 47 j » / « demain ». */
  detail: string
  /** Null = item informatif, pas de navigation mobile dédiée. */
  href: string | null
}

export interface VisitBrief {
  items: BriefItem[]
  /** Nombre d'items hors des 4 affichés — 0 si tout est montré. */
  overflow: number
}

const TZ = 'Pacific/Noumea'
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function todayNoumea(): string {
  return dayFmt.format(Date.now())
}

function in7DaysNoumea(): string {
  return dayFmt.format(Date.now() + 7 * 86_400_000)
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000)
}

export async function buildVisitBrief(siteId: string, maxItems = 4): Promise<VisitBrief | null> {
  const today = todayNoumea()
  const in7days = in7DaysNoumea()

  const supabase = createAdminClient()

  const [actionsRes, reservesRes, deadlinesRes] = await Promise.all([
    // Actions en retard : due_date passée, non terminées.
    supabase
      .from('site_actions')
      .select('id, title, due_date')
      .eq('site_id', siteId)
      .in('status', ['open', 'planned'])
      .not('due_date', 'is', null)
      .lt('due_date', today)
      .order('due_date', { ascending: true }) // plus en retard = due_date la plus ancienne
      .limit(maxItems + 10),

    // Réserves ouvertes — tri par ancienneté dans le JS (issued_on COALESCE created_at).
    supabase
      .from('site_reserve')
      .select('id, label, issued_on, created_at')
      .eq('site_id', siteId)
      .eq('status', 'open')
      .limit(maxItems + 10),

    // Échéances imminentes : d'aujourd'hui à J+7, non traitées.
    supabase
      .from('site_deadlines')
      .select('id, title, due_date')
      .eq('site_id', siteId)
      .in('status', ['to_plan', 'planned'])
      .not('due_date', 'is', null)
      .gte('due_date', today)
      .lte('due_date', in7days)
      .is('deleted_at', null)
      .order('due_date', { ascending: true })
      .limit(maxItems + 10),
  ])

  const items: BriefItem[] = []

  // 1 — Actions en retard
  for (const a of (actionsRes.data ?? []) as Array<{ id: string; title: string; due_date: string }>) {
    const days = daysBetween(a.due_date, today)
    items.push({
      kind: 'action_overdue',
      label: a.title,
      detail: days <= 1 ? '1 j de retard' : `${days} j de retard`,
      href: `/m/actions?site=${siteId}`,
    })
  }

  // 2 — Réserves vieillissantes (plus ancienne d'abord)
  const reservesSorted = ((reservesRes.data ?? []) as Array<{
    id: string; label: string; issued_on: string | null; created_at: string
  }>).sort((a, b) => {
    const aDate = a.issued_on ?? a.created_at.slice(0, 10)
    const bDate = b.issued_on ?? b.created_at.slice(0, 10)
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0
  })

  for (const r of reservesSorted) {
    const since = r.issued_on ?? r.created_at.slice(0, 10)
    const days = daysBetween(since, today)
    let detail: string
    if (days === 0) detail = "ouverte aujourd'hui"
    else if (days === 1) detail = 'ouverte hier'
    else detail = `ouverte depuis ${days} j`
    items.push({
      kind: 'reserve_aging',
      label: r.label,
      detail,
      href: null,
    })
  }

  // 3 — Échéances imminentes
  for (const d of (deadlinesRes.data ?? []) as Array<{ id: string; title: string; due_date: string }>) {
    const days = daysBetween(today, d.due_date)
    let detail: string
    if (days === 0) detail = "aujourd'hui"
    else if (days === 1) detail = 'demain'
    else detail = `dans ${days} j`
    items.push({
      kind: 'deadline_soon',
      label: d.title,
      detail,
      href: null,
    })
  }

  if (items.length === 0) return null

  const overflow = Math.max(0, items.length - maxItems)
  return { items: items.slice(0, maxItems), overflow }
}
