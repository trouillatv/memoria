// Contextualiseur — couche PURE (aucun import server-only).
//
// « Quand parler » vit ICI, et c'est CONTEXTUEL à la surface — jamais un
// classement global figé dans le signal (un même signal n'a pas la même
// importance sur le dashboard, le planning ou une fiche site).

import type { MemorySignal, SignalKind } from './types'
import { SIGNAL_REGISTRY, type SignalFamily } from './registry'

/**
 * Conflits sémantiques : certains signaux s'excluent pour un MÊME sujet — on ne
 * peut pas présenter un lieu comme « continuité assurée » ET en « instabilité
 * de relais » (fenêtres distinctes, faits tous deux vrais, mais message
 * contradictoire). La fragilité prime : on ne rassure jamais à tort.
 */
const SUPPRESSED_BY: Partial<Record<SignalKind, SignalKind[]>> = {
  continuity_stable: ['relay_instability'],
}

/** Retire, par sujet, les signaux supprimés par un signal concurrent présent. */
export function resolveSubjectConflicts(signals: MemorySignal[]): MemorySignal[] {
  const presentBySubject = new Map<string, Set<SignalKind>>()
  for (const s of signals) {
    const key = `${s.subjectType}:${s.subjectId}`
    const set = presentBySubject.get(key) ?? new Set<SignalKind>()
    set.add(s.kind)
    presentBySubject.set(key, set)
  }
  return signals.filter((s) => {
    const suppressors = SUPPRESSED_BY[s.kind]
    if (!suppressors) return true
    const present = presentBySubject.get(`${s.subjectType}:${s.subjectId}`)
    return !suppressors.some((k) => present?.has(k))
  })
}

export interface SurfacePolicy {
  surface: 'dashboard' | 'site' | 'planning'
  /** Nombre max de signaux par famille (anti-surcharge). */
  perFamilyCap?: number
  scope?: { siteId?: string; teamId?: string }
}

/**
 * Filtre (scope) + ordonne + plafonne selon la politique de la surface.
 * Politique par défaut : fragilité d'abord, puis le plus récent. C'est un
 * choix de SURFACE, assumé ici — pas une importance gravée dans le signal.
 */
export function forSurface(signals: MemorySignal[], policy: SurfacePolicy): MemorySignal[] {
  let s = resolveSubjectConflicts(signals)
  if (policy.scope?.siteId) {
    s = s.filter((x) => x.subjectType === 'site' && x.subjectId === policy.scope!.siteId)
  }
  if (policy.scope?.teamId) {
    s = s.filter((x) => x.subjectType === 'team' && x.subjectId === policy.scope!.teamId)
  }

  const fragileFirst = (k: MemorySignal['kind']) =>
    SIGNAL_REGISTRY[k].valence === 'fragile' ? 0 : 1

  const ordered = [...s].sort(
    (a, b) =>
      fragileFirst(a.kind) - fragileFirst(b.kind) ||
      (b.lastRelevantEventAt ?? '').localeCompare(a.lastRelevantEventAt ?? ''),
  )

  if (!policy.perFamilyCap) return ordered

  const perFamily = new Map<SignalFamily, number>()
  const out: MemorySignal[] = []
  for (const sig of ordered) {
    const fam = SIGNAL_REGISTRY[sig.kind].family
    const n = perFamily.get(fam) ?? 0
    if (n >= policy.perFamilyCap) continue
    perFamily.set(fam, n + 1)
    out.push(sig)
  }
  return out
}
