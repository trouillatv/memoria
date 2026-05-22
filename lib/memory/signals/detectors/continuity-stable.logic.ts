// Détecteur continuity_stable — CŒUR PUR (sans server-only → testable).
//
// Santé : un lieu documenté par PLUSIEURS équipes sur la fenêtre → la mémoire a
// un relais, elle ne se perd pas si une équipe part. Pendant positif de la
// future relay_instability. Sujet = lieu.

import type { MemorySignal } from '../types'

export const STABLE_WINDOW_DAYS = 90
export const STABLE_MIN_TEAMS = 2

/** Une couverture = une intervention documentée d'une équipe sur un site. */
export interface CoverageInput {
  siteId: string
  siteName: string
  teamId: string
  interventionAt: string
}

/** Pur & déterministe : signale les sites couverts par >= minTeams équipes. */
export function buildContinuityStableSignals(
  rows: CoverageInput[],
  nowMs: number,
  windowDays: number = STABLE_WINDOW_DAYS,
  minTeams: number = STABLE_MIN_TEAMS,
): MemorySignal[] {
  const cutoff = nowMs - windowDays * 86_400_000
  type Agg = { name: string; teams: Set<string>; latestMs: number; latestIso: string }
  const bySite = new Map<string, Agg>()

  for (const r of rows) {
    if (!r.siteId || !r.siteName || !r.teamId || !r.interventionAt) continue
    const ms = new Date(r.interventionAt).getTime()
    if (Number.isNaN(ms) || ms < cutoff) continue
    const cur = bySite.get(r.siteId)
    if (cur) {
      cur.teams.add(r.teamId)
      if (ms > cur.latestMs) {
        cur.latestMs = ms
        cur.latestIso = r.interventionAt
      }
    } else {
      bySite.set(r.siteId, { name: r.siteName, teams: new Set([r.teamId]), latestMs: ms, latestIso: r.interventionAt })
    }
  }

  const detectedAt = new Date(nowMs).toISOString()
  const out: MemorySignal[] = []
  for (const [siteId, v] of bySite) {
    if (v.teams.size < minTeams) continue
    out.push({
      kind: 'continuity_stable',
      subjectType: 'site',
      subjectId: siteId,
      subjectLabel: v.name,
      facts: { knownByTeams: v.teams.size },
      confidence: 'certain',
      detectedAt,
      lastRelevantEventAt: v.latestIso,
      evidence: {
        rule: `${v.teams.size} équipes ont documenté ce lieu sur ${windowDays}j (>= ${minTeams})`,
        refs: [...v.teams].sort(),
      },
    })
  }
  return out.sort((a, b) => a.subjectId.localeCompare(b.subjectId))
}
