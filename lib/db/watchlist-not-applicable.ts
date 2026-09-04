// lib/db/watchlist-not-applicable.ts
// Accès données de la mémoire du verdict « sans objet » (WOW-2A′).
//
// Deux lectures, aucune écriture :
//   1. les verdicts `not_applicable` déjà rendus sur le chantier, avec le motif
//      de la visite pendant laquelle ils ont été rendus ;
//   2. la FRAÎCHEUR MÉTIER de chaque source citée — « cet objet a-t-il bougé
//      depuis ? ».
//
// Fraîcheur : générique, jamais par label ni mot-clé. On lit la ligne source et
// on prend la plus récente de ses horloges `*_at`, en EXCLUANT `created_at` :
// une date de création (souvent posée par un import) ne prouve aucun changement
// métier. Une ligne sans aucune horloge posée renvoie `null` = « rien ne s'est
// passé », ce qui est une information, pas une inconnue. Une ligne introuvable
// n'entre pas dans la Map : la fraîcheur est alors INCONNUE et l'appelant
// repropose (direction d'échec conservatrice).
//
// `site_actions` n'a pas de colonne `updated_at`, mais toute mutation passe par
// la RPC qui écrit `site_action_events` dans la même transaction (mig 221) :
// le journal EST l'horloge de changement de cette famille.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  watchlistSourceKey,
  type NotApplicableVerdict,
} from '@/lib/visits/watchlist-not-applicable-memory'
import type { VisitMotive } from '@/types/db'

/** Table source par famille de signal. `proof_window_closing` est absent
 *  volontairement : son source_ref est ambigu (intervention | action) et cette
 *  famille n'est de toute façon jamais supprimée. */
const SOURCE_TABLE: Readonly<Record<string, string>> = {
  reserve_open: 'site_reserve',
  action_overdue: 'site_actions',
  decision_unapplied: 'site_decisions',
  obligation_neglected: 'site_obligation',
}

/** Date de création : jamais une preuve de changement métier. */
function latestChangeStamp(row: Record<string, unknown>): string | null {
  let latest: string | null = null
  for (const [column, value] of Object.entries(row)) {
    if (!column.endsWith('_at') || column === 'created_at') continue
    if (typeof value !== 'string' || !value) continue
    if (latest === null || value > latest) latest = value
  }
  return latest
}

/** Verdicts « sans objet » du chantier, avec le motif de leur visite. */
export async function loadNotApplicableVerdicts(siteId: string): Promise<NotApplicableVerdict[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_watchlist_item')
    .select('report_id, source_kind, source_ref, updated_at')
    .eq('site_id', siteId)
    .eq('state', 'not_applicable')
    .not('source_ref', 'is', null)
  if (error) throw error
  const rows = data ?? []
  if (rows.length === 0) return []

  const reportIds = [...new Set(rows.map((r) => r.report_id as string).filter(Boolean))]
  const motiveByReport = new Map<string, VisitMotive | null>()
  if (reportIds.length > 0) {
    const { data: reports } = await supabase
      .from('site_reports')
      .select('id, visit_motive')
      .in('id', reportIds)
    for (const r of reports ?? []) {
      motiveByReport.set(r.id as string, (r.visit_motive as VisitMotive | null) ?? null)
    }
  }

  return rows.map((r) => ({
    source_kind: r.source_kind as string,
    source_ref: r.source_ref as string,
    visit_motive: motiveByReport.get(r.report_id as string) ?? null,
    decided_at: r.updated_at as string,
  }))
}

/** Fraîcheur métier des sources citées. Clé = `source_kind|source_ref`.
 *  Clé absente ⇒ inconnue (l'appelant repropose). */
export async function loadSourceChangedAt(
  refs: Array<{ source_kind: string; source_ref: string }>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (refs.length === 0) return out

  const byKind = new Map<string, Set<string>>()
  for (const r of refs) {
    if (!SOURCE_TABLE[r.source_kind] || !r.source_ref) continue
    const set = byKind.get(r.source_kind) ?? new Set<string>()
    set.add(r.source_ref)
    byKind.set(r.source_kind, set)
  }
  if (byKind.size === 0) return out

  const supabase = createAdminClient()
  for (const [kind, ids] of byKind) {
    const table = SOURCE_TABLE[kind]
    const { data, error } = await supabase.from(table).select('*').in('id', [...ids])
    if (error) continue // famille illisible → fraîcheur inconnue → on reproposera
    for (const row of data ?? []) {
      const id = (row as Record<string, unknown>).id as string
      out.set(watchlistSourceKey(kind, id), latestChangeStamp(row as Record<string, unknown>))
    }
  }

  // Actions : le journal des événements est l'horloge de changement.
  const actionIds = byKind.get('action_overdue')
  if (actionIds && actionIds.size > 0) {
    const { data: events } = await supabase
      .from('site_action_events')
      .select('action_id, occurred_at')
      .in('action_id', [...actionIds])
    for (const e of events ?? []) {
      const key = watchlistSourceKey('action_overdue', e.action_id as string)
      if (!out.has(key)) continue // action introuvable : on ne fabrique pas d'identité
      const occurredAt = e.occurred_at as string | null
      if (!occurredAt) continue
      const current = out.get(key) ?? null
      if (current === null || occurredAt > current) out.set(key, occurredAt)
    }
  }

  return out
}
