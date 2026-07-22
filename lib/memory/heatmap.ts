// Heatmap mémoire / continuité — enveloppe DB (server-only).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { buildMemoryHeatmap, type HeatmapCell } from './heatmap.logic'

export type { HeatmapCell, MemoryTone } from './heatmap.logic'

export async function getMemoryHeatmap(days = 84): Promise<HeatmapCell[]> {
  const sb = createAdminClient()
  // Scope ORG (admin client bypasse les RLS) — sinon le « Temps mémoriel » agrège
  // l'activité de toutes les organisations.
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return buildMemoryHeatmap({ acknowledgedDates: [], sharedDates: [], noteDates: [], openAnomalyDates: [] }, Date.now(), days)
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString()

  const [acks, shares, notes, anomalies] = await Promise.all([
    sb.from('handover_briefs').select('acknowledged_at').in('organization_id', orgIds).gte('acknowledged_at', sinceIso).not('acknowledged_at', 'is', null),
    sb.from('handover_briefs').select('shared_at').in('organization_id', orgIds).gte('shared_at', sinceIso).not('shared_at', 'is', null),
    sb.from('site_notes').select('created_at').in('organization_id', orgIds).eq('kind', 'a_savoir').is('deleted_at', null).gte('created_at', sinceIso),
    sb.from('intervention_anomalies').select('created_at').in('organization_id', orgIds).eq('status', 'open').gte('created_at', sinceIso),
  ])

  const dates = (rows: Array<Record<string, unknown>> | null, col: string): string[] =>
    (rows ?? []).map((r) => r[col]).filter((v): v is string => typeof v === 'string')

  return buildMemoryHeatmap(
    {
      acknowledgedDates: dates(acks.data, 'acknowledged_at'),
      sharedDates: dates(shares.data, 'shared_at'),
      noteDates: dates(notes.data, 'created_at'),
      openAnomalyDates: dates(anomalies.data, 'created_at'),
    },
    Date.now(),
    days,
  )
}
