// Détecteur memory_awaiting — CŒUR PUR (aucun import server-only → testable).
//
// Détecte une mémoire PRODUITE/PARTAGÉE qui n'a pas encore circulé jusqu'au
// bout : une passation partagée mais non reconnue depuis > seuil. Sujet = le
// lieu (chaque site du snapshot). Jamais une personne, jamais une injonction
// (le wording non-impératif est la responsabilité du renderer).

import type { MemorySignal } from '../types'

export const AWAITING_THRESHOLD_DAYS = 3

/** Entrée pure : une passation partagée (déjà filtrée status='shared'). */
export interface AwaitingBriefInput {
  id: string
  sharedAt: string
  /** access_count > 0 (la passation a au moins été ouverte). */
  consulted: boolean
  sites: Array<{ site_id: string; site_name: string }>
}

/**
 * Pur & déterministe : mêmes entrées + même `nowMs` ⇒ mêmes signaux.
 * Un signal par lieu, en agrégeant les passations en attente qui le concernent.
 */
export function buildMemoryAwaitingSignals(
  briefs: AwaitingBriefInput[],
  nowMs: number,
  thresholdDays: number = AWAITING_THRESHOLD_DAYS,
): MemorySignal[] {
  type Agg = {
    name: string
    count: number
    maxDays: number
    oldestSharedAt: string
    refs: string[]
    anyConsulted: boolean
  }
  const bySite = new Map<string, Agg>()

  for (const b of briefs) {
    const days = Math.floor((nowMs - new Date(b.sharedAt).getTime()) / 86_400_000)
    if (days < thresholdDays) continue
    for (const s of b.sites) {
      if (!s.site_id || !s.site_name) continue
      const cur = bySite.get(s.site_id)
      if (cur) {
        cur.count += 1
        cur.refs.push(b.id)
        cur.anyConsulted = cur.anyConsulted || b.consulted
        if (days > cur.maxDays) {
          cur.maxDays = days
          cur.oldestSharedAt = b.sharedAt
        }
      } else {
        bySite.set(s.site_id, {
          name: s.site_name,
          count: 1,
          maxDays: days,
          oldestSharedAt: b.sharedAt,
          refs: [b.id],
          anyConsulted: b.consulted,
        })
      }
    }
  }

  const detectedAt = new Date(nowMs).toISOString()
  const out: MemorySignal[] = []
  for (const [siteId, v] of bySite) {
    out.push({
      kind: 'memory_awaiting',
      subjectType: 'site',
      subjectId: siteId,
      subjectLabel: v.name,
      facts: { awaitingBriefs: v.count, daysSinceShared: v.maxDays, consulted: v.anyConsulted },
      confidence: 'certain',
      detectedAt,
      lastRelevantEventAt: v.oldestSharedAt,
      evidence: {
        rule: `passation partagée non reconnue depuis ${v.maxDays}j (seuil ${thresholdDays}j)`,
        refs: v.refs.slice().sort(),
      },
    })
  }
  // Ordre stable (déterminisme du tableau).
  return out.sort((a, b) => a.subjectId.localeCompare(b.subjectId))
}
