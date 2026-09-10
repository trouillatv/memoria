// P6 — Page interne d'observation du Live Writer (mandat Vincent, 2026-09-10).
//
// Lecture SEULE : ne modifie jamais tracked_point_reconcile_event/state/artifact, ne
// rappelle jamais fn_reconcile_tracked_point_unit. Source de vérité = ce qui est
// réellement persisté par le writer (tracked_point_reconcile_event, migration 400),
// pas les logs Vercel (diagnostic technique uniquement, cf. doctrine Vincent).
//
// tracked_point_reconcile_event n'a pas de colonne "run id" : pour source_kind=
// 'historical_pdf', source_ref_id = documents.id (un seul document par appel de
// runTrackedPointLiveWriterForHistoricalRun, cf. tracked-point-live-writer-historical-
// adapter.ts:426-429) mais un même document peut en théorie être retraité plusieurs
// fois. Un "run" est donc reconstruit ici par regroupement (site_id, source_kind,
// source_ref_id) PUIS séparation en occurrences par écart temporel (RUN_GAP_MS) —
// heuristique, pas un identifiant stable stocké. Documenté explicitement côté UI.

import { createAdminClient } from '@/lib/supabase/admin'
import type { ReconcileVerdict, ReconcileWritePattern } from '@/lib/db/tracked-point-live-writer'

export type LiveWriterSourceKind = 'historical_pdf' | 'field_visit' | 'meeting'

export interface LiveWriterEventRow {
  id: string
  siteId: string
  unitKey: string
  verdict: ReconcileVerdict
  writePattern: ReconcileWritePattern
  targetPointId: string | null
  replayed: boolean
  sourceKind: LiveWriterSourceKind
  sourceRefId: string | null
  occurredAt: string
}

export interface LiveWriterRun {
  siteId: string
  siteName: string
  sourceKind: LiveWriterSourceKind
  sourceRefId: string | null
  startAt: string
  endAt: string
  unitsProcessed: number
  verdictCounts: Partial<Record<ReconcileVerdict, number>>
  // Sous-catégorie de NEEDS_HUMAN : nombre d'événements de CE run ayant matérialisé une
  // NOUVELLE tracked_point_pending_trace de kind='IDENTITY_UNRESOLVED' (via reconcile_
  // artifact — migration 400/401). N'inclut PAS les cas où une trace IDENTITY_UNRESOLVED
  // déjà ouverte a été réutilisée sans nouvelle écriture (§7.5 de la RPC : aucun artifact
  // n'est alors inséré) — c'est le flux de NOUVEAUX cas non résolus, pas le stock ouvert.
  identityUnresolvedCount: number
  anomalies: {
    autoCreatedHigh: boolean
    needsHumanHigh: boolean
  }
}

// Écart au-delà duquel deux événements du même (site, source_kind, source_ref_id) sont
// considérés comme deux runs distincts plutôt qu'un seul (ex. reprocessing du même
// document à deux dates différentes). Un run réel traite ses unités séquentiellement
// (verrous par ligne, cf. migration 401) donc quelques secondes/minutes d'écart au sein
// d'un même run ; 10 min est une marge large sans donnée d'usage réelle pour la calibrer.
const RUN_GAP_MS = 10 * 60 * 1000

// Seuils d'anomalie — heuristiques de premier jet (rollout du jour même), à ajuster
// avec l'usage réel plutôt que fixées a priori. Ignore les tout petits runs (< 5 unités)
// pour éviter le bruit d'un taux à 100 % sur 1 unité.
const AUTO_CREATED_RATE_ALERT = 0.5
const NEEDS_HUMAN_COUNT_ALERT = 10
const NEEDS_HUMAN_RATE_ALERT = 0.5
const MIN_UNITS_FOR_RATE_ALERT = 5

function toEventRow(row: Record<string, unknown>): LiveWriterEventRow {
  return {
    id: row.id as string,
    siteId: row.site_id as string,
    unitKey: row.unit_key as string,
    verdict: row.verdict as ReconcileVerdict,
    writePattern: row.write_pattern as ReconcileWritePattern,
    targetPointId: (row.target_point_id as string | null) ?? null,
    replayed: Boolean(row.replayed),
    sourceKind: row.source_kind as LiveWriterSourceKind,
    sourceRefId: (row.source_ref_id as string | null) ?? null,
    occurredAt: row.occurred_at as string,
  }
}

/** Pure, testable : regroupe des événements déjà triés par occurred_at croissant en runs. */
export function groupEventsIntoRuns(
  events: LiveWriterEventRow[],
  siteNameById: Map<string, string>,
  identityUnresolvedEventIds: Set<string> = new Set(),
  gapMs: number = RUN_GAP_MS,
): LiveWriterRun[] {
  const byKey = new Map<string, LiveWriterEventRow[]>()
  for (const ev of events) {
    const key = `${ev.siteId}|${ev.sourceKind}|${ev.sourceRefId ?? ''}`
    const arr = byKey.get(key) ?? []
    arr.push(ev)
    byKey.set(key, arr)
  }

  const runs: LiveWriterRun[] = []
  for (const [, evs] of byKey) {
    const sorted = [...evs].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    let bucket: LiveWriterEventRow[] = []
    const flush = () => {
      if (bucket.length === 0) return
      const verdictCounts: Partial<Record<ReconcileVerdict, number>> = {}
      for (const ev of bucket) verdictCounts[ev.verdict] = (verdictCounts[ev.verdict] ?? 0) + 1
      const unitsProcessed = bucket.length
      const autoCreated = verdictCounts.AUTO_CREATED ?? 0
      const needsHuman = verdictCounts.NEEDS_HUMAN ?? 0
      const first = bucket[0]
      const last = bucket[bucket.length - 1]
      const identityUnresolvedCount = bucket.filter((ev) => identityUnresolvedEventIds.has(ev.id)).length
      runs.push({
        siteId: first.siteId,
        siteName: siteNameById.get(first.siteId) ?? first.siteId,
        sourceKind: first.sourceKind,
        sourceRefId: first.sourceRefId,
        startAt: first.occurredAt,
        endAt: last.occurredAt,
        unitsProcessed,
        verdictCounts,
        identityUnresolvedCount,
        anomalies: {
          autoCreatedHigh:
            unitsProcessed >= MIN_UNITS_FOR_RATE_ALERT && autoCreated / unitsProcessed > AUTO_CREATED_RATE_ALERT,
          needsHumanHigh:
            needsHuman > NEEDS_HUMAN_COUNT_ALERT ||
            (unitsProcessed >= MIN_UNITS_FOR_RATE_ALERT && needsHuman / unitsProcessed > NEEDS_HUMAN_RATE_ALERT),
        },
      })
      bucket = []
    }

    for (const ev of sorted) {
      if (bucket.length === 0) {
        bucket.push(ev)
        continue
      }
      const prev = bucket[bucket.length - 1]
      const gap = new Date(ev.occurredAt).getTime() - new Date(prev.occurredAt).getTime()
      if (gap > gapMs) flush()
      bucket.push(ev)
    }
    flush()
  }

  return runs.sort((a, b) => b.endAt.localeCompare(a.endAt))
}

async function loadSiteNames(sb: ReturnType<typeof createAdminClient>, siteIds: string[]): Promise<Map<string, string>> {
  if (siteIds.length === 0) return new Map()
  const { data } = await sb.from('sites').select('id, name').in('id', siteIds)
  return new Map((data ?? []).map((s: { id: string; name: string }) => [s.id, s.name]))
}

// Sous-catégorie de NEEDS_HUMAN : événements ayant matérialisé une NOUVELLE
// tracked_point_pending_trace de kind='IDENTITY_UNRESOLVED' (migration 400/401 §7.5 —
// aucun artifact n'est inséré si une trace du même kind était déjà ouverte et réutilisée,
// donc ceci compte le flux de nouveaux cas, pas le stock ouvert — cf. commentaire de tête).
async function loadIdentityUnresolvedEventIds(
  sb: ReturnType<typeof createAdminClient>,
  eventIds: string[],
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set()
  const { data: artifacts } = await sb
    .from('tracked_point_reconcile_artifact')
    .select('reconcile_event_id, artifact_id')
    .eq('artifact_kind', 'tracked_point_pending_trace')
    .in('reconcile_event_id', eventIds)
  const rows = (artifacts ?? []) as Array<{ reconcile_event_id: string; artifact_id: string }>
  if (rows.length === 0) return new Set()

  const traceIds = [...new Set(rows.map((r) => r.artifact_id))]
  const { data: traces } = await sb
    .from('tracked_point_pending_trace')
    .select('id, kind')
    .eq('kind', 'IDENTITY_UNRESOLVED')
    .in('id', traceIds)
  const identityTraceIds = new Set((traces ?? []).map((t: { id: string }) => t.id))

  return new Set(rows.filter((r) => identityTraceIds.has(r.artifact_id)).map((r) => r.reconcile_event_id))
}

function periodCutoff(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

/** Sites ayant au moins un événement Live Writer — pour le filtre. */
export async function getLiveWriterSites(): Promise<Array<{ id: string; name: string }>> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('tracked_point_reconcile_event')
    .select('site_id')
    .order('occurred_at', { ascending: false })
    .limit(5000)
  const siteIds = [...new Set((data ?? []).map((r: { site_id: string }) => r.site_id))]
  const names = await loadSiteNames(sb, siteIds)
  return siteIds
    .map((id) => ({ id, name: names.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Derniers runs (reconstruits) sur la période, filtrés par site en option. */
export async function getLiveWriterRuns(params: {
  periodDays: number
  siteId?: string
}): Promise<LiveWriterRun[]> {
  const sb = createAdminClient()
  let query = sb
    .from('tracked_point_reconcile_event')
    .select('id, site_id, unit_key, verdict, write_pattern, target_point_id, replayed, source_kind, source_ref_id, occurred_at')
    .gte('occurred_at', periodCutoff(params.periodDays))
    .order('occurred_at', { ascending: true })
    .limit(20000)
  if (params.siteId) query = query.eq('site_id', params.siteId)

  const { data } = await query
  const events = (data ?? []).map(toEventRow)
  const siteIds = [...new Set(events.map((e) => e.siteId))]
  const [names, identityUnresolvedEventIds] = await Promise.all([
    loadSiteNames(sb, siteIds),
    loadIdentityUnresolvedEventIds(sb, events.map((e) => e.id)),
  ])
  return groupEventsIntoRuns(events, names, identityUnresolvedEventIds)
}

/** Détail des événements d'un run reconstruit (drill-down depuis la liste). */
export async function getLiveWriterRunEvents(params: {
  siteId: string
  sourceKind: LiveWriterSourceKind
  sourceRefId: string | null
  from: string
  to: string
}): Promise<LiveWriterEventRow[]> {
  const sb = createAdminClient()
  // Marge de 1s de part et d'autre : startAt/endAt viennent des mêmes événements qu'on
  // veut retrouver (bornes inclusives), pas d'un identifiant de run stocké séparément.
  const from = new Date(new Date(params.from).getTime() - 1000).toISOString()
  const to = new Date(new Date(params.to).getTime() + 1000).toISOString()
  let query = sb
    .from('tracked_point_reconcile_event')
    .select('id, site_id, unit_key, verdict, write_pattern, target_point_id, replayed, source_kind, source_ref_id, occurred_at')
    .eq('site_id', params.siteId)
    .eq('source_kind', params.sourceKind)
    .gte('occurred_at', from)
    .lte('occurred_at', to)
    .order('occurred_at', { ascending: true })
  query = params.sourceRefId ? query.eq('source_ref_id', params.sourceRefId) : query.is('source_ref_id', null)

  const { data } = await query
  return (data ?? []).map(toEventRow)
}

export interface LiveWriterSummary {
  totalUnits: number
  siteCount: number
  verdictCounts: Partial<Record<ReconcileVerdict, number>>
  identityUnresolvedCount: number
}

function summarize(events: LiveWriterEventRow[], identityUnresolvedEventIds: Set<string>): LiveWriterSummary {
  const verdictCounts: Partial<Record<ReconcileVerdict, number>> = {}
  for (const ev of events) verdictCounts[ev.verdict] = (verdictCounts[ev.verdict] ?? 0) + 1
  return {
    totalUnits: events.length,
    siteCount: new Set(events.map((e) => e.siteId)).size,
    verdictCounts,
    identityUnresolvedCount: events.filter((e) => identityUnresolvedEventIds.has(e.id)).length,
  }
}

/** Résumés 24h / 7 jours, en une seule requête (7j couvre 24h), filtrés par site en option. */
export async function getLiveWriterSummaries(siteId?: string): Promise<{ last24h: LiveWriterSummary; last7d: LiveWriterSummary }> {
  const sb = createAdminClient()
  let query = sb
    .from('tracked_point_reconcile_event')
    .select('id, site_id, unit_key, verdict, write_pattern, target_point_id, replayed, source_kind, source_ref_id, occurred_at')
    .gte('occurred_at', periodCutoff(7))
    .limit(20000)
  if (siteId) query = query.eq('site_id', siteId)

  const { data } = await query
  const events = (data ?? []).map(toEventRow)
  const identityUnresolvedEventIds = await loadIdentityUnresolvedEventIds(sb, events.map((e) => e.id))
  const cutoff24h = periodCutoff(1)
  const last24h = events.filter((e) => e.occurredAt >= cutoff24h)
  return {
    last24h: summarize(last24h, identityUnresolvedEventIds),
    last7d: summarize(events, identityUnresolvedEventIds),
  }
}
