// DOC-CONTRACT-OS-1B4-B0 (mandat Vincent 2026-09-30, sur HOLD 1B4-B/448/1B4-C) —
// brique contractuelle structurée minimale représentant une cadence
// d'intervention (« 1 fois/semaine », « 2 fois/semaine », « 3 fois/semaine »).
//
// Doctrine (non négociable, cf. mandat) :
//   1. La cadence est un fait CONTRACTUEL, jamais un fait Planning — aucun
//      jour, heure, équipe ou notion de cycle ici (1B4-C, hors périmètre).
//   2. Structure stockée dans engagement_contract_effects.effect_payload.cadence
//      (JSONB déjà libre, aucun CHECK de forme, aucune migration nécessaire —
//      cf. audit ciblé 1B4-B0 : la RPC materialize_engagement_contract_effect
//      applique p_effect_payload tel quel pour NEW/MODIFY/SUSPEND).
//   3. AUCUNE dérivation depuis frequency_raw/description/source_excerpt/label
//      — un humain saisit explicitement { count, period }. « L'IA propose,
//      l'humain décide » : si une proposition IA existe un jour, elle reste
//      une suggestion pré-remplie, jamais une écriture automatique.
//   4. Absence de cadence structurée = donnée honnête (legacy), jamais une
//      valeur inventée par lecture de texte libre.
//   5. Ce module ne duplique JAMAIS la logique de résolution temporelle de
//      resolve-contract-state.ts (gagnant MODIFY, orphelins, conflits) — il
//      compose avec son DTO déjà calculé (resolveContractCadenceAtDate) et,
//      pour le fondateur NEW (dont le payload n'est jamais exposé via
//      scopes[].value — doctrine 3 de resolve-contract-state.ts), consulte
//      directement le tableau brut d'effets via existence.foundedBy.

import type { EngagementContractEffectRow, EngagementContractStateDTO } from './resolve-contract-state'

export type CadencePeriod = 'day' | 'week' | 'month'

export type ContractCadence = {
  count: number
  period: CadencePeriod
}

const CADENCE_PERIODS: ReadonlySet<string> = new Set<CadencePeriod>(['day', 'week', 'month'])

/** Aucune coercition — un `count` fourni en chaîne ("2") n'est jamais accepté. */
export function isValidCadence(value: unknown): value is ContractCadence {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.count !== 'number' || !Number.isInteger(v.count) || v.count <= 0) return false
  if (typeof v.period !== 'string' || !CADENCE_PERIODS.has(v.period)) return false
  return true
}

/** Fragment à fusionner dans effect_payload — jamais le payload entier (une
 *  description humaine libre peut coexister à côté de `cadence`). */
export function buildCadenceEffectPayloadFragment(cadence: ContractCadence): { cadence: ContractCadence } {
  return { cadence: { count: cadence.count, period: cadence.period } }
}

/** Lit EXCLUSIVEMENT la clé `cadence` d'un effect_payload déjà matérialisé —
 *  ne lit jamais `description`, `frequency_raw`, `source_excerpt` ni `label`. */
export function extractCadenceFromEffectPayload(payload: Record<string, unknown> | null | undefined): ContractCadence | null {
  if (!payload) return null
  const candidate = payload.cadence
  if (!isValidCadence(candidate)) return null
  return { count: candidate.count, period: candidate.period }
}

/**
 * Cadence contractuelle structurée applicable à `state.queriedDate`, ou
 * `null` si non connue structurellement (legacy, conflit, engagement non
 * existant à cette date) — jamais une valeur devinée.
 *
 * Compose avec `resolveEngagementAtDate(...)` déjà exécuté par l'appelant :
 * priorité à un éventuel MODIFY gagnant sur la portée `frequency`, repli sur
 * le payload propre du fondateur NEW sinon (scope 'frequency' absent quand
 * aucun MODIFY/SUSPEND n'a jamais touché cette portée — cf.
 * resolve-contract-state.ts, scopeKeys n'est peuplé que par MODIFY/SUSPEND).
 */
export function resolveContractCadenceAtDate(
  effects: EngagementContractEffectRow[],
  state: EngagementContractStateDTO,
): ContractCadence | null {
  if (state.existence.status !== 'exists') return null

  const frequencyScope = state.scopes.find((s) => s.scopeKey === 'frequency')
  if (frequencyScope) {
    // Doctrine 7 de resolve-contract-state.ts : un conflit de valeur ne
    // départage jamais silencieusement — indéterminé prime sur invention.
    if (frequencyScope.valueConflict) return null
    if (frequencyScope.basis === 'modify') {
      return extractCadenceFromEffectPayload(frequencyScope.value as Record<string, unknown> | null)
    }
  }

  const founderId = state.existence.foundedBy
  if (!founderId) return null
  const founder = effects.find((e) => e.id === founderId && e.effect === 'new')
  if (!founder) return null
  return extractCadenceFromEffectPayload(founder.effectPayload)
}
