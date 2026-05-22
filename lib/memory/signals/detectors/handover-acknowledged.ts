// Détecteur : PASSATION RECONNUE (santé).
//
// Une passation (handover) dont la reconnaissance a été accusée récemment → la
// mémoire a CIRCULÉ. Signal positif de premier rang (le moteur naît équilibré).
// Sujet = chaque lieu dont la mémoire a été transmise (snapshot payload.sites).
// Déterministe.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MemorySignal } from '../types'
import type { HandoverPayload } from '@/types/db'

const ACK_WINDOW_DAYS = 14

export async function detectHandoverAcknowledged(): Promise<MemorySignal[]> {
  const sb = createAdminClient()
  const sinceIso = new Date(Date.now() - ACK_WINDOW_DAYS * 86_400_000).toISOString()

  const { data } = await sb
    .from('handover_briefs')
    .select('id, acknowledged_at, payload')
    .eq('status', 'acknowledged')
    .gte('acknowledged_at', sinceIso)
    .order('acknowledged_at', { ascending: false })

  type Row = { id: string; acknowledged_at: string | null; payload: HandoverPayload | null }

  // Un signal par lieu transmis, en gardant la reconnaissance la plus récente.
  const bySite = new Map<string, { name: string; ackAt: string }>()
  for (const b of (data ?? []) as Row[]) {
    if (!b.acknowledged_at) continue
    for (const site of b.payload?.sites ?? []) {
      if (!site.site_id || !site.site_name) continue
      if (!bySite.has(site.site_id)) {
        bySite.set(site.site_id, { name: site.site_name, ackAt: b.acknowledged_at }) // ordre desc → 1re = la + récente
      }
    }
  }

  const now = Date.now()
  const out: MemorySignal[] = []
  for (const [siteId, v] of bySite) {
    const daysAgo = Math.max(0, Math.floor((now - new Date(v.ackAt).getTime()) / 86_400_000))
    out.push({
      kind: 'handover_acknowledged',
      subjectType: 'site',
      subjectId: siteId,
      subjectLabel: v.name,
      facts: { daysAgo },
      confidence: 'certain',
      detectedAt: new Date().toISOString(),
      lastRelevantEventAt: v.ackAt,
      evidence: { rule: `passation reconnue il y a ${daysAgo}j (fenêtre ${ACK_WINDOW_DAYS}j)` },
    })
  }
  return out
}
