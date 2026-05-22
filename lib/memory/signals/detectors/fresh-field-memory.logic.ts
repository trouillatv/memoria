// Détecteur fresh_field_memory — CŒUR PUR (sans server-only → testable).
//
// Santé : des « à savoir » terrain notés récemment sur un site → la mémoire y
// vit. Sujet = lieu.

import type { MemorySignal } from '../types'

export const FRESH_WINDOW_DAYS = 7

export interface FieldNoteInput {
  id: string
  siteId: string
  siteName: string
  createdAt: string
}

/** Pur & déterministe : un signal par lieu, agrégeant les « à savoir » de la fenêtre. */
export function buildFreshFieldMemorySignals(
  notes: FieldNoteInput[],
  nowMs: number,
  windowDays: number = FRESH_WINDOW_DAYS,
): MemorySignal[] {
  const cutoff = nowMs - windowDays * 86_400_000
  type Agg = { name: string; count: number; latestMs: number; latestIso: string; refs: string[] }
  const bySite = new Map<string, Agg>()

  for (const n of notes) {
    if (!n.siteId || !n.siteName) continue
    const ms = new Date(n.createdAt).getTime()
    if (Number.isNaN(ms) || ms < cutoff) continue
    const cur = bySite.get(n.siteId)
    if (cur) {
      cur.count += 1
      cur.refs.push(n.id)
      if (ms > cur.latestMs) {
        cur.latestMs = ms
        cur.latestIso = n.createdAt
      }
    } else {
      bySite.set(n.siteId, { name: n.siteName, count: 1, latestMs: ms, latestIso: n.createdAt, refs: [n.id] })
    }
  }

  const detectedAt = new Date(nowMs).toISOString()
  const out: MemorySignal[] = []
  for (const [siteId, v] of bySite) {
    out.push({
      kind: 'fresh_field_memory',
      subjectType: 'site',
      subjectId: siteId,
      subjectLabel: v.name,
      facts: { notesAdded: v.count },
      confidence: 'certain',
      detectedAt,
      lastRelevantEventAt: v.latestIso,
      evidence: { rule: `${v.count} « à savoir » noté(s) sur ${windowDays}j`, refs: v.refs.slice().sort() },
    })
  }
  return out.sort((a, b) => a.subjectId.localeCompare(b.subjectId))
}
