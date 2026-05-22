// Détecteur unusual_silence — enveloppe DB (server-only).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MemorySignal } from '../types'
import {
  buildUnusualSilenceSignals,
  type SiteInput,
  type TraceInput,
} from './unusual-silence.logic'

const DOCUMENTED_STATUSES = ['completed', 'validated'] as const

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] as T) ?? null : v
}

export async function detectUnusualSilence(): Promise<MemorySignal[]> {
  const sb = createAdminClient()

  // Sites actifs (contrat actif, non supprimés).
  const { data: sitesRaw } = await sb
    .from('sites')
    .select('id, name, contract:contracts(status)')
    .is('deleted_at', null)
  const sites: SiteInput[] = ((sitesRaw ?? []) as Array<{
    id: string
    name: string
    contract: { status: string } | { status: string }[] | null
  }>)
    .filter((s) => pickOne(s.contract)?.status === 'active')
    .map((s) => ({ id: s.id, name: s.name }))
  if (sites.length === 0) return []

  // Interventions documentées (statut completed/validated) → traces.
  const { data: rows } = await sb
    .from('interventions')
    .select('scheduled_for, status, mission:missions!inner(site_id)')
    .in('status', DOCUMENTED_STATUSES as unknown as string[])

  const traces: TraceInput[] = []
  for (const r of (rows ?? []) as Array<{
    scheduled_for: string | null
    mission: { site_id: string } | { site_id: string }[] | null
  }>) {
    const m = pickOne(r.mission)
    if (!m?.site_id || !r.scheduled_for) continue
    traces.push({ siteId: m.site_id, scheduledFor: r.scheduled_for })
  }

  return buildUnusualSilenceSignals(sites, traces, Date.now())
}
