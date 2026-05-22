// Détecteur relay_instability — CŒUR PUR (sans server-only → testable).
//
// Fragilité : un lieu sur lequel un grand nombre d'équipes DIFFÉRENTES sont
// intervenues sur une fenêtre COURTE → rotation chaotique, continuité fragile
// implicite. Sujet = lieu (jamais une équipe ni une personne). Pendant négatif
// de continuity_stable (fenêtres et seuils distincts).

import type { MemorySignal } from '../types'

export const INSTABILITY_WINDOW_DAYS = 7
export const INSTABILITY_MIN_TEAMS = 3

/** Une rotation = une intervention d'une équipe sur un site dans la fenêtre courte. */
export interface RotationInput {
  siteId: string
  siteName: string
  teamId: string
  interventionAt: string
}

/** Pur & déterministe : signale les sites couverts par >= minTeams équipes sur la fenêtre. */
export function buildRelayInstabilitySignals(
  rows: RotationInput[],
  nowMs: number,
  windowDays: number = INSTABILITY_WINDOW_DAYS,
  minTeams: number = INSTABILITY_MIN_TEAMS,
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
      kind: 'relay_instability',
      subjectType: 'site',
      subjectId: siteId,
      subjectLabel: v.name,
      facts: { teamsInWindow: v.teams.size, windowDays },
      confidence: 'certain',
      detectedAt,
      lastRelevantEventAt: v.latestIso,
      evidence: {
        rule: `${v.teams.size} équipes différentes en ${windowDays}j (>= ${minTeams})`,
        refs: [...v.teams].sort(),
      },
    })
  }
  return out.sort((a, b) => a.subjectId.localeCompare(b.subjectId))
}
