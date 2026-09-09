// P6 Live Writer — Phase 3 (fingerprint) : input_snapshot canonique + input_fingerprint.
//
// Contrat de canonicalisation (design §2.5, obligatoire avant implémentation) : tri stable
// des arrays, distinction explicite null/absent, ordre de clés fixe. Le fingerprint ne sert
// JAMAIS seul à conclure NOOP (§2.5) — il permet seulement de détecter qu'une revalidation
// live complète est nécessaire quand il change, et sert de clé de lecture rapide dans
// tracked_point_reconcile_state.
//
// cboIds : FoundingUnit (tel que porté en Phase 2) ne conserve un cboId que dans le cas
// CONFIRMED (outcomeV2.cboId) — la fonction buildFoundingUnits n'émet jamais d'unité portant
// plusieurs CBO simultanément (une unité scope=proposal_set par CBO). Le tableau reste donc
// structurellement 0 ou 1 élément aujourd'hui ; le contrat "array trié" est conservé tel quel
// pour rester correct si cette contrainte change en amont.
//
// Frozen — voir docs/tracked-points/p6-live-writer-design.md §2.5, §2.6.

import { createHash } from 'node:crypto'
import type { FoundingUnit } from './tracked-point-founding'

export type InputSnapshot = {
  threadId: string
  scope: 'thread' | 'proposal_set'
  proposalSetOf: string | null
  cboIds: string[]
  families: string[]
  outcomeV2: unknown
  trackability: string | null
}

function cboIdsOf(u: FoundingUnit): string[] {
  const outcome = u.outcomeV2 as { kind: string; cboId?: string }
  return outcome.kind === 'CONFIRMED' && outcome.cboId ? [outcome.cboId] : []
}

export function buildInputSnapshot(u: FoundingUnit): InputSnapshot {
  return {
    threadId: u.threadId,
    scope: u.scope,
    proposalSetOf: u.proposalSetOf ?? null,
    cboIds: [...cboIdsOf(u)].sort(),
    families: [...u.families].sort(),
    outcomeV2: u.outcomeV2,
    trackability: u.trackability ?? null,
  }
}

/**
 * Stringification déterministe : clés d'objet triées récursivement (ordre alphabétique),
 * null et undefined convergent explicitement vers "null", arrays sérialisés dans l'ordre
 * fourni (déjà triés en amont pour cboIds/families par buildInputSnapshot).
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(record[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function computeInputFingerprint(snapshot: InputSnapshot): string {
  return createHash('sha256').update(canonicalStringify(snapshot)).digest('hex')
}

export function buildFingerprint(u: FoundingUnit): { snapshot: InputSnapshot; fingerprint: string } {
  const snapshot = buildInputSnapshot(u)
  return { snapshot, fingerprint: computeInputFingerprint(snapshot) }
}
