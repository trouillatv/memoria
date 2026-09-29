// DOC-CONTRACT-OS-1B4-B (mandat Vincent 2026-09-30, sur audit 1B4-A FINAL
// CLOSED — GO_1B4_B, HOLD_1B4_C) — moteur pur de construction des
// Propositions d'impact Planning à partir d'un effet contractuel matérialisé
// (engagement_contract_effects, migration 445/446/447).
//
// Contraintes d'architecture (mandat, non négociables, même discipline que
// resolve-contract-state.ts) :
//   - AUCUNE dépendance Supabase/DB — reçoit l'effet (et, pour MODIFY, la
//     valeur de portée précédente) déjà résolus par l'appelant.
//   - proposal_payload ne contient JAMAIS de donnée Planning/application
//     (jour, heure, équipe, planning_cycle_id, occurrence) — uniquement
//     l'impact contractuel interprété. L'application est 1B4-C, HOLD.
//   - resolvePlanningApplicationCapability est un LOOKUP STATIQUE, jamais un
//     accès DB : l'audit 1B4-A a établi qu'aucune clé étrangère ne relie
//     Engagement à un objet Planning précis — une vérification par instance
//     est donc impossible aujourd'hui, et la capacité d'application ne
//     dépend que du impact_kind. Ce résultat n'est JAMAIS persisté (il
//     deviendrait une vérité périmée si le Planning évolue).

import { createHash } from 'node:crypto'
import { canonicalStringify } from '@/lib/knowledge/tracked-point-fingerprint'
import type { ContractTemporality } from './contract-effect'
import type { EngagementContractEffectRow, MaterializedContractEffect } from './resolve-contract-state'

export type PlanningImpactKind = Extract<MaterializedContractEffect, 'new' | 'modify' | 'suspend'>

export type NewPlanningImpactPayload = {
  operation: 'new'
  temporality: ContractTemporality
  effectiveFrom: string | null
  effectiveTo: string | null
}

export type ModifyPlanningImpactPayload = {
  operation: string
  scopeKey: string
  effectiveFrom: string | null
  effectiveTo: string | null
  from: unknown
  to: Record<string, unknown>
}

export type SuspendPlanningImpactPayload = {
  operation: 'suspend'
  effectiveFrom: string
  effectiveTo: string | null
  resumeOn: string | null
}

export type PlanningImpactProposalPayload =
  | NewPlanningImpactPayload
  | ModifyPlanningImpactPayload
  | SuspendPlanningImpactPayload

/**
 * Construit la proposition d'impact Planning d'un effet contractuel
 * matérialisé. Rend `null` pour CONFIRM (provenance pure, jamais un impact
 * Planning — doctrine 8 de resolve-contract-state.ts).
 *
 * `priorScopeValue` : uniquement pertinent pour MODIFY — la valeur de la
 * portée `effect.scopeKey` juste avant `effect.startsOn`, déjà résolue par
 * l'appelant (via `resolveEngagementAtDate` sur l'historique complet, à
 * `startsOn - 1 jour`). `null`/`undefined` si non résolvable (ex. MODIFY sans
 * `startsOn`, effective immédiatement) — jamais recalculée ici.
 */
export function buildPlanningImpactProposalPayload(
  effect: EngagementContractEffectRow,
  priorScopeValue?: unknown,
): PlanningImpactProposalPayload | null {
  switch (effect.effect) {
    case 'new':
      return {
        operation: 'new',
        temporality: effect.temporality,
        effectiveFrom: effect.startsOn,
        effectiveTo: effect.endsOn,
      }
    case 'modify':
      return {
        operation: `change_${effect.scopeKey}`,
        scopeKey: effect.scopeKey,
        effectiveFrom: effect.startsOn,
        effectiveTo: effect.endsOn,
        from: priorScopeValue ?? null,
        to: effect.effectPayload,
      }
    case 'suspend':
      return {
        operation: 'suspend',
        // CHECK engagement_contract_effects_suspend_starts_check (445) garantit
        // startsOn non nul pour tout effet SUSPEND matérialisé.
        effectiveFrom: effect.startsOn as string,
        effectiveTo: effect.endsOn,
        resumeOn: effect.resumeOn,
      }
    case 'confirm':
      return null
  }
}

export type PlanningImpactProposalFingerprintInput = {
  contractEffectId: string
  impactKind: PlanningImpactKind
  proposalPayload: PlanningImpactProposalPayload
  proposalVersion: number
}

/** hash(contract_effect_id + impact_kind + proposal_payload canonisé +
 *  proposal_version) — cf. commentaire de la migration 448. Réutilise
 *  `canonicalStringify` (lib/knowledge/tracked-point-fingerprint.ts), seul
 *  mécanisme de hachage déterministe existant dans le dépôt. */
export function computePlanningImpactProposalFingerprint(input: PlanningImpactProposalFingerprintInput): string {
  return createHash('sha256').update(canonicalStringify(input)).digest('hex')
}

export type PlanningApplicationBlockingReason =
  | 'new_requires_human_scheduling'
  | 'no_native_recurring_frequency_change'
  | 'no_native_suspend_resume'

export type PlanningApplicationCapability = {
  applicable: boolean
  blockingReason: PlanningApplicationBlockingReason
  missingDecisions: string[]
}

// Verdict générique par impact_kind (cf. audit DOC-CONTRACT-OS-1B4-A,
// classification PROPOSAL_READINESS/APPLICATION_READINESS corrigée) :
// aucun des trois cas n'est aujourd'hui applicable automatiquement dans le
// Planning — NEW exige un jour/heure/équipe/durée jamais dérivables du
// contrat seul, MODIFY (fréquence) n'a pas de mécanisme natif de
// régénération de cycle, SUSPEND n'a pas de mécanisme natif de
// suspension/reprise. 1B4-C pourra changer ce verdict ; il n'est jamais
// persisté ici pour ne pas figer une vérité qui deviendrait périmée.
const CAPABILITY_BY_IMPACT_KIND: Record<PlanningImpactKind, PlanningApplicationCapability> = {
  new: {
    applicable: false,
    blockingReason: 'new_requires_human_scheduling',
    missingDecisions: ['jour', 'heure', 'équipe', 'durée'],
  },
  modify: {
    applicable: false,
    blockingReason: 'no_native_recurring_frequency_change',
    missingDecisions: ['cycle_planning_cible', 'occurrences_a_regenerer'],
  },
  suspend: {
    applicable: false,
    blockingReason: 'no_native_suspend_resume',
    missingDecisions: ['occurrences_a_annuler', 'mecanisme_de_reprise'],
  },
}

/** Calculée à la volée, JAMAIS persistée (cf. commentaire de tête). */
export function resolvePlanningApplicationCapability(impactKind: PlanningImpactKind): PlanningApplicationCapability {
  return CAPABILITY_BY_IMPACT_KIND[impactKind]
}
