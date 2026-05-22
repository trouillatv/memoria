// Détecteur : MÉMOIRE CONFIRMÉE RÉCEMMENT (santé).
//
// Un site où des « à savoir » terrain ont été notés cette semaine → la mémoire
// y vit. Signal POSITIF de premier rang (sinon le moteur ne montre que du
// fragile = anxiogène). Sujet = le lieu. Déterministe.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MemorySignal } from '../types'

const FRESH_WINDOW_DAYS = 7

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] as T) ?? null : v
}

export async function detectFreshFieldMemory(): Promise<MemorySignal[]> {
  const sb = createAdminClient()
  const sinceIso = new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString()

  const { data } = await sb
    .from('site_notes')
    .select('site_id, created_at, kind, site:sites!inner(id, name, deleted_at)')
    .eq('kind', 'a_savoir')
    .is('deleted_at', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })

  type Row = {
    site_id: string
    created_at: string
    site: { id: string; name: string; deleted_at: string | null } | { id: string; name: string; deleted_at: string | null }[] | null
  }

  const bySite = new Map<string, { name: string; count: number; latest: string }>()
  for (const r of (data ?? []) as Row[]) {
    const site = pickOne(r.site)
    if (!site?.id || !site.name || site.deleted_at) continue
    const cur = bySite.get(site.id)
    if (cur) {
      cur.count += 1
      if (r.created_at > cur.latest) cur.latest = r.created_at
    } else {
      bySite.set(site.id, { name: site.name, count: 1, latest: r.created_at })
    }
  }

  const out: MemorySignal[] = []
  for (const [siteId, agg] of bySite) {
    out.push({
      kind: 'fresh_field_memory',
      subjectType: 'site',
      subjectId: siteId,
      subjectLabel: agg.name,
      facts: { notesAdded: agg.count },
      confidence: 'certain',
      detectedAt: new Date().toISOString(),
      lastRelevantEventAt: agg.latest,
      evidence: { rule: `${agg.count} « à savoir » noté(s) sur ${FRESH_WINDOW_DAYS}j` },
    })
  }
  return out
}
