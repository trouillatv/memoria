// Phase 3.3 — Mémoire du lieu : timeline agrégée par site.
//
// Vue projetée à partir des données existantes. Aucune saisie supplémentaire.
// Le site devient un objet temporel : on lit son histoire, on ne configure rien.

import { createAdminClient } from '@/lib/supabase/admin'

export type SiteMemoryEventType =
  | 'intervention'
  | 'photo'
  | 'anomaly'
  | 'note'
  | 'a_savoir'

export interface SiteMemoryEvent {
  type: SiteMemoryEventType
  id: string
  occurredAt: string
  title: string
  detail: string | null
  status?: string | null
  // Pour navigation cross-objet.
  interventionId?: string | null
  // Métadonnées spécifiques par type
  meta?: Record<string, string | number | boolean | null>
}

export async function getSiteMemoryTimeline(
  siteId: string,
  options: { limit?: number; periodDays?: number } = {},
): Promise<SiteMemoryEvent[]> {
  const sb = createAdminClient()
  const limit = options.limit ?? 100
  const since = options.periodDays
    ? new Date(Date.now() - options.periodDays * 86400_000).toISOString()
    : null

  // 1. Missions du site
  const { data: missions } = await sb
    .from('missions')
    .select('id, name')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  const missionNameById = new Map<string, string>(
    (missions ?? []).map((m) => [m.id, m.name as string]),
  )

  // 2. Interventions (via missions)
  let interventions: Array<{
    id: string
    status: string
    scheduled_at: string
    executed_at: string | null
    notes: string | null
    mission_id: string
  }> = []
  if (missionIds.length) {
    let q = sb
      .from('interventions')
      .select('id, status, scheduled_at, executed_at, notes, mission_id')
      .in('mission_id', missionIds)
    if (since) q = q.gte('scheduled_at', since)
    const { data } = await q
    interventions = (data ?? []) as typeof interventions
  }
  const interventionIds = interventions.map((i) => i.id)

  // 3. Photos / Anomalies (via interventions)
  const [photosRes, anomaliesRes, notesRes] = await Promise.all([
    interventionIds.length
      ? sb
          .from('intervention_photos')
          .select('id, intervention_id, caption, kind, taken_at')
          .in('intervention_id', interventionIds)
      : { data: [] as Array<{ id: string; intervention_id: string; caption: string | null; kind: string; taken_at: string }> },
    interventionIds.length
      ? sb
          .from('intervention_anomalies')
          .select('id, intervention_id, description, category, category_other, status, created_at, resolved_at')
          .in('intervention_id', interventionIds)
      : { data: [] as Array<{ id: string; intervention_id: string; description: string | null; category: string; category_other: string | null; status: string; created_at: string; resolved_at: string | null }> },
    sb
      .from('site_notes')
      .select('id, body, kind, active_until, created_at')
      .eq('site_id', siteId)
      .is('deleted_at', null),
  ])

  const events: SiteMemoryEvent[] = []

  for (const i of interventions) {
    events.push({
      type: 'intervention',
      id: i.id,
      occurredAt: i.executed_at ?? i.scheduled_at,
      title: missionNameById.get(i.mission_id) ?? 'Intervention',
      detail: i.notes,
      status: i.status,
      interventionId: i.id,
    })
  }

  for (const p of (photosRes.data ?? [])) {
    events.push({
      type: 'photo',
      id: p.id,
      occurredAt: p.taken_at,
      title: p.caption ?? `Photo ${p.kind}`,
      detail: null,
      interventionId: p.intervention_id,
      meta: { kind: p.kind },
    })
  }

  for (const a of (anomaliesRes.data ?? [])) {
    events.push({
      type: 'anomaly',
      id: a.id,
      occurredAt: a.created_at,
      title: a.description ?? a.category_other ?? a.category,
      detail: null,
      status: a.status,
      interventionId: a.intervention_id,
      meta: { category: a.category, resolved_at: a.resolved_at },
    })
  }

  for (const n of (notesRes.data ?? [])) {
    events.push({
      type: n.kind === 'a_savoir' ? 'a_savoir' : 'note',
      id: n.id,
      occurredAt: n.created_at,
      title: n.body,
      detail: null,
      meta: { active_until: n.active_until },
    })
  }

  // Tri chronologique inversé, cap au limit.
  events.sort((a, b) => (b.occurredAt > a.occurredAt ? 1 : b.occurredAt < a.occurredAt ? -1 : 0))
  return events.slice(0, limit)
}
