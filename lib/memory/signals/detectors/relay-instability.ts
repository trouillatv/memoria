// Détecteur relay_instability — enveloppe DB (server-only).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type { MemorySignal } from '../types'
import {
  buildRelayInstabilitySignals,
  INSTABILITY_WINDOW_DAYS,
  type RotationInput,
} from './relay-instability.logic'

// Rotation = qui est ASSIGNÉ sur la fenêtre (planned inclus), pas seulement le
// documenté — la rotation se lit aussi sur ce qui est programmé.
const ROTATION_STATUSES = ['planned', 'in_progress', 'completed', 'validated'] as const

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] as T) ?? null : v
}

export async function detectRelayInstability(): Promise<MemorySignal[]> {
  const sb = createAdminClient()
  const orgId = await getOrgId().catch(() => null)
  if (!orgId) return []
  const sinceIso = new Date(Date.now() - INSTABILITY_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const { data } = await sb
    .from('interventions')
    .select('assigned_team_id, scheduled_for, status, mission:missions!inner(site:sites!inner(id, name, deleted_at))')
    .eq('organization_id', orgId)
    .in('status', ROTATION_STATUSES as unknown as string[])
    .gte('scheduled_for', sinceIso)
    .not('assigned_team_id', 'is', null)

  type Row = {
    assigned_team_id: string | null
    scheduled_for: string | null
    mission:
      | { site: { id: string; name: string; deleted_at: string | null } | { id: string; name: string; deleted_at: string | null }[] }
      | { site: { id: string; name: string; deleted_at: string | null } | { id: string; name: string; deleted_at: string | null }[] }[]
      | null
  }

  const rows: RotationInput[] = []
  for (const r of (data ?? []) as Row[]) {
    if (!r.assigned_team_id || !r.scheduled_for) continue
    const mission = pickOne(r.mission)
    const site = mission ? pickOne(mission.site) : null
    if (!site?.id || !site.name || site.deleted_at) continue
    rows.push({
      siteId: site.id,
      siteName: site.name,
      teamId: r.assigned_team_id,
      interventionAt: r.scheduled_for,
    })
  }

  return buildRelayInstabilitySignals(rows, Date.now())
}
