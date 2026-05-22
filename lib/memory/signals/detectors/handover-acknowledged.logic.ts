// Détecteur handover_acknowledged — CŒUR PUR (sans server-only → testable).
//
// Santé : une passation reconnue récemment → la mémoire a circulé. Sujet = lieu.

import type { MemorySignal } from '../types'

export const ACK_WINDOW_DAYS = 14

export interface AckBriefInput {
  id: string
  acknowledgedAt: string
  sites: Array<{ site_id: string; site_name: string }>
}

/** Pur & déterministe : un signal par lieu, reconnaissance la plus récente retenue. */
export function buildHandoverAcknowledgedSignals(
  briefs: AckBriefInput[],
  nowMs: number,
  windowDays: number = ACK_WINDOW_DAYS,
): MemorySignal[] {
  const cutoff = nowMs - windowDays * 86_400_000
  type Agg = { name: string; latestMs: number; latestIso: string; refs: string[] }
  const bySite = new Map<string, Agg>()

  for (const b of briefs) {
    const ms = new Date(b.acknowledgedAt).getTime()
    if (Number.isNaN(ms) || ms < cutoff) continue
    for (const s of b.sites) {
      if (!s.site_id || !s.site_name) continue
      const cur = bySite.get(s.site_id)
      if (cur) {
        cur.refs.push(b.id)
        if (ms > cur.latestMs) {
          cur.latestMs = ms
          cur.latestIso = b.acknowledgedAt
        }
      } else {
        bySite.set(s.site_id, { name: s.site_name, latestMs: ms, latestIso: b.acknowledgedAt, refs: [b.id] })
      }
    }
  }

  const detectedAt = new Date(nowMs).toISOString()
  const out: MemorySignal[] = []
  for (const [siteId, v] of bySite) {
    const daysAgo = Math.max(0, Math.floor((nowMs - v.latestMs) / 86_400_000))
    out.push({
      kind: 'handover_acknowledged',
      subjectType: 'site',
      subjectId: siteId,
      subjectLabel: v.name,
      facts: { daysAgo },
      confidence: 'certain',
      detectedAt,
      lastRelevantEventAt: v.latestIso,
      evidence: { rule: `passation reconnue il y a ${daysAgo}j (fenêtre ${windowDays}j)`, refs: v.refs.slice().sort() },
    })
  }
  return out.sort((a, b) => a.subjectId.localeCompare(b.subjectId))
}
