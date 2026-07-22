// Détecteur continuity_stable — enveloppe DB (server-only).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import type { MemorySignal } from '../types'
import {
  buildContinuityStableSignals,
  STABLE_WINDOW_DAYS,
  type CoverageInput,
} from './continuity-stable.logic'

const DOCUMENTED_STATUSES = ['completed', 'validated'] as const

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] as T) ?? null : v
}

export async function detectContinuityStable(): Promise<MemorySignal[]> {
  const sb = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return []
  const sinceIso = new Date(Date.now() - STABLE_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const { data } = await sb
    .from('interventions')
    .select('assigned_team_id, scheduled_for, status, mission:missions!inner(site:sites!inner(id, name, deleted_at))')
    .in('organization_id', orgIds)
    .in('status', DOCUMENTED_STATUSES as unknown as string[])
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

  const rows: CoverageInput[] = []
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

  return buildContinuityStableSignals(rows, Date.now())
}
