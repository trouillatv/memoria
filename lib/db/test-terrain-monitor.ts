// lib/db/test-terrain-monitor.ts
// Monitoring du TEST TERRAIN (module Visite + « Fait aujourd'hui »). Lecture SEULE :
// agrège les nouveaux objets directement depuis leurs tables — AUCUNE instrumentation
// du code testé, AUCUN changement de l'expérience du conducteur.
//
// Doctrine : OBSERVATION PRODUIT (le module est-il utilisé ?), jamais RH. Ce sont des
// COMPTES agrégés (combien de visites/captures/marquages), pas un score par personne.
// Admin-only (la page vit sous /admin, gated par le layout). Org-scopé. Résilient.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { localDateOf, todayLocalIso } from '@/lib/time/local-date'

export interface TerrainTestSnapshot {
  days: number
  visits: { started: number; ongoing: number; ended: number }
  captures: { total: number; byKind: Record<string, number> }
  transcription: { pending: number; done: number; failed: number }
  triage: { captured: number; kept: number; discarded: number; toAction: number; toFollow: number }
  actions: { doneToday: number; treated: number }
  recent: Array<{ at: string; kind: string; site: string }>
}

const EMPTY: TerrainTestSnapshot = {
  days: 7,
  visits: { started: 0, ongoing: 0, ended: 0 },
  captures: { total: 0, byKind: {} },
  transcription: { pending: 0, done: 0, failed: 0 },
  triage: { captured: 0, kept: 0, discarded: 0, toAction: 0, toFollow: 0 },
  actions: { doneToday: 0, treated: 0 },
  recent: [],
}

export async function getTerrainTestSnapshot(days = 7): Promise<TerrainTestSnapshot> {
  try {
    const supabase = createAdminClient()
    const orgId = await getOrgId().catch(() => null) // M3_TELEMETRY_EXCEPTION — log/tracking, org null accepté
    if (!orgId) return { ...EMPTY, days }
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const today = todayLocalIso()

    // Sites de l'org (pour scoper les actions + nommer les captures).
    const { data: siteRows } = await supabase
      .from('sites').select('id, name').eq('organization_id', orgId).is('deleted_at', null)
    const sites = (siteRows ?? []) as Array<{ id: string; name: string }>
    const siteName = new Map(sites.map((s) => [s.id, s.name]))
    const siteIds = sites.map((s) => s.id)

    // ── Visites (site_reports avec origin) ──
    const { data: visitRows } = await supabase
      .from('site_reports').select('ended_at').eq('organization_id', orgId)
      .not('origin', 'is', null).gte('created_at', since)
    const visits = { started: 0, ongoing: 0, ended: 0 }
    for (const v of (visitRows ?? []) as Array<{ ended_at: string | null }>) {
      visits.started++
      if (v.ended_at) visits.ended++
      else visits.ongoing++
    }

    // ── Captures de visite ──
    const { data: capRows } = await supabase
      .from('visit_capture')
      .select('kind, status, transcript_status, triage_intent, site_id, created_at')
      .eq('organization_id', orgId).gte('created_at', since)
      .order('created_at', { ascending: false })
    const caps = (capRows ?? []) as Array<{
      kind: string; status: string; transcript_status: string | null
      triage_intent: string | null; site_id: string; created_at: string
    }>
    const byKind: Record<string, number> = {}
    const transcription = { pending: 0, done: 0, failed: 0 }
    const triage = { captured: 0, kept: 0, discarded: 0, toAction: 0, toFollow: 0 }
    for (const c of caps) {
      byKind[c.kind] = (byKind[c.kind] ?? 0) + 1
      if (c.kind === 'vocal') {
        if (c.transcript_status === 'pending') transcription.pending++
        else if (c.transcript_status === 'done') transcription.done++
        else if (c.transcript_status === 'failed') transcription.failed++
      }
      if (c.status === 'captured') triage.captured++
      else if (c.status === 'discarded') triage.discarded++
      else triage.kept++ // kept | processed
      if (c.triage_intent === 'action') triage.toAction++
      else if (c.triage_intent === 'follow') triage.toFollow++
    }
    const recent = caps.slice(0, 20).map((c) => ({
      at: c.created_at, kind: c.kind, site: siteName.get(c.site_id) ?? '—',
    }))

    // ── Actions : « fait aujourd'hui » (jour LOCAL) + traitées sur la période ──
    let doneToday = 0
    let treated = 0
    if (siteIds.length > 0) {
      const { data: progressRows } = await supabase
        .from('site_actions').select('last_progress_at')
        .in('site_id', siteIds).not('last_progress_at', 'is', null).gte('last_progress_at', since)
      for (const r of (progressRows ?? []) as Array<{ last_progress_at: string }>) {
        if (localDateOf(new Date(r.last_progress_at)) === today) doneToday++
      }
      const { count } = await supabase
        .from('site_actions').select('id', { count: 'exact', head: true })
        .in('site_id', siteIds).eq('status', 'done').gte('done_at', since)
      treated = count ?? 0
    }

    return {
      days,
      visits,
      captures: { total: caps.length, byKind },
      transcription,
      triage,
      actions: { doneToday, treated },
      recent,
    }
  } catch {
    return { ...EMPTY, days }
  }
}
