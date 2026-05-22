// Détecteur unusual_silence — CŒUR PUR (sans server-only → testable).
//
// Fragilité : un site qui A EU de l'activité documentée mais plus depuis >
// seuil. « Mémoire négative ». Sujet = lieu.

import type { MemorySignal } from '../types'

export const SILENCE_THRESHOLD_DAYS = 12

export interface SiteInput {
  id: string
  name: string
}

/** Une trace = une intervention documentée (completed/validated) sur un site. */
export interface TraceInput {
  siteId: string
  scheduledFor: string
}

/** Pur & déterministe : flag des sites actifs sans trace depuis >= seuil. */
export function buildUnusualSilenceSignals(
  sites: SiteInput[],
  traces: TraceInput[],
  nowMs: number,
  thresholdDays: number = SILENCE_THRESHOLD_DAYS,
): MemorySignal[] {
  const lastBySite = new Map<string, string>()
  for (const t of traces) {
    if (!t.siteId || !t.scheduledFor) continue
    const cur = lastBySite.get(t.siteId)
    if (!cur || t.scheduledFor > cur) lastBySite.set(t.siteId, t.scheduledFor)
  }

  const detectedAt = new Date(nowMs).toISOString()
  const out: MemorySignal[] = []
  for (const site of sites) {
    const last = lastBySite.get(site.id)
    if (!last) continue // jamais d'activité = site neuf, pas un silence
    const days = Math.floor((nowMs - new Date(last).getTime()) / 86_400_000)
    if (days < thresholdDays) continue
    out.push({
      kind: 'unusual_silence',
      subjectType: 'site',
      subjectId: site.id,
      subjectLabel: site.name,
      facts: { daysSinceLastTrace: days },
      confidence: 'certain',
      detectedAt,
      lastRelevantEventAt: last,
      evidence: { rule: `aucune intervention documentée depuis ${days}j (seuil ${thresholdDays}j)` },
    })
  }
  return out.sort((a, b) => a.subjectId.localeCompare(b.subjectId))
}
