// Détecteur : SILENCE INHABITUEL (fragilité).
//
// Un site qui A EU de l'activité documentée mais n'en a plus depuis > seuil.
// « Mémoire négative » — les humains détectent mal une absence. Sujet = le lieu.
// Déterministe (confidence 'certain').

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MemorySignal } from '../types'

const SILENCE_THRESHOLD_DAYS = 12
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
  const activeSites = ((sitesRaw ?? []) as Array<{
    id: string
    name: string
    contract: { status: string } | { status: string }[] | null
  }>).filter((s) => pickOne(s.contract)?.status === 'active')
  if (activeSites.length === 0) return []

  // Dernière intervention documentée par site (la plus récente).
  const { data: rows } = await sb
    .from('interventions')
    .select('scheduled_for, status, mission:missions!inner(site_id)')
    .in('status', DOCUMENTED_STATUSES as unknown as string[])
    .order('scheduled_for', { ascending: false })

  const lastBySite = new Map<string, string>()
  for (const r of (rows ?? []) as Array<{
    scheduled_for: string | null
    mission: { site_id: string } | { site_id: string }[] | null
  }>) {
    const m = pickOne(r.mission)
    if (!m?.site_id || !r.scheduled_for) continue
    if (!lastBySite.has(m.site_id)) lastBySite.set(m.site_id, r.scheduled_for) // ordre desc → 1re = la + récente
  }

  const now = Date.now()
  const out: MemorySignal[] = []
  for (const site of activeSites) {
    const last = lastBySite.get(site.id)
    if (!last) continue // jamais d'activité documentée = site neuf, pas un silence
    const days = Math.floor((now - new Date(last).getTime()) / 86_400_000)
    if (days < SILENCE_THRESHOLD_DAYS) continue
    out.push({
      kind: 'unusual_silence',
      subjectType: 'site',
      subjectId: site.id,
      subjectLabel: site.name,
      facts: { daysSinceLastTrace: days },
      confidence: 'certain',
      detectedAt: new Date().toISOString(),
      lastRelevantEventAt: last,
      evidence: {
        rule: `aucune intervention documentée depuis ${days}j (seuil ${SILENCE_THRESHOLD_DAYS}j)`,
      },
    })
  }
  return out
}
