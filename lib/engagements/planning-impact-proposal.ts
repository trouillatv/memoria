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
//   - resolvePlanningApplicationCapability n'accède JAMAIS à la DB : l'audit
//     1B4-A a établi qu'aucune clé étrangère ne relie Engagement à un objet
//     Planning précis — une vérification par instance est donc impossible
//     aujourd'hui. Elle dépend de impact_kind ET du proposal_payload déjà
//     construit (jamais un lookup statique par impact_kind seul — cf. mandat
//     FIX_REQUIRED Vincent 2026-09-30, problème 3). Ce résultat n'est JAMAIS
//     persisté (il deviendrait une vérité périmée si le Planning évolue).

import { createHash } from 'node:crypto'
import { canonicalStringify } from '@/lib/knowledge/tracked-point-fingerprint'
import type { ContractTemporality } from './contract-effect'
import type { EngagementContractEffectRow, MaterializedContractEffect } from './resolve-contract-state'

export type PlanningImpactKind = Extract<MaterializedContractEffect, 'new' | 'modify' | 'suspend'>

// Sous-ensemble de scope_key dont la MODIFICATION touche réellement
// l'organisation Planning (fréquence/rythme d'intervention). Un MODIFY sur
// tout autre scope_key (ex. "quantity", "access", "equipment") est un fait
// contractuel réel mais SANS impact Planning — cf. mandat FIX_REQUIRED
// Vincent 2026-09-30, problème 4 (« effet contractuel ≠ proposition
// Planning »). Vocabulaire aligné sur le <datalist> de qualification
// (ProposalCard.tsx) — pas d'enum DB, ajustable sans migration.
export const PLANNING_RELEVANT_MODIFY_SCOPE_KEYS: ReadonlySet<string> = new Set(['frequency', 'schedule'])

export type NewPlanningImpactPayload = {
  operation: 'new'
  temporality: ContractTemporality
  effectiveFrom: string | null
  effectiveTo: string | null
  scopeKey: string
  effectPayload: Record<string, unknown>
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
 *
 * MODIFY sur un `scopeKey` hors PLANNING_RELEVANT_MODIFY_SCOPE_KEYS rend
 * `null` : l'effet contractuel est réel (matérialisé dans
 * engagement_contract_effects) mais n'a aucun impact Planning à proposer.
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
        scopeKey: effect.scopeKey,
        effectPayload: effect.effectPayload,
      }
    case 'modify':
      if (!PLANNING_RELEVANT_MODIFY_SCOPE_KEYS.has(effect.scopeKey)) return null
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

// PARTIALLY_REPRESENTABLE : un mécanisme Planning natif existe (ex.
// fn_plan_supersede_cycle_exclusive, migration 444, bascule versionnée d'un
// cycle publié) mais requiert une traduction humaine (quelle Mission cible,
// quels slots/ancre/longueur de cycle) — jamais une application automatique.
// BLOCKED_BY_PLANNING_MODEL : aucun mécanisme natif n'existe aujourd'hui pour
// ce cas, quelle que soit la richesse de la proposition.
// NO_APPLICATION : l'effet contractuel n'a structurellement aucune vocation
// à s'appliquer dans le Planning (NEW = création hors modèle Planning tant
// qu'aucun jour/heure/équipe n'est décidé humainement ; MODIFY sur un
// scope_key non lié au rythme d'intervention).
export type PlanningApplicationReadiness = 'partially_representable' | 'blocked_by_planning_model' | 'no_application'

export type PlanningApplicationBlockingReason =
  | 'new_requires_human_scheduling'
  | 'recurring_change_requires_mission_targeting'
  | 'scope_not_planning_related'
  | 'no_native_suspend_resume'

export type PlanningApplicationCapability = {
  readiness: PlanningApplicationReadiness
  blockingReason: PlanningApplicationBlockingReason
  missingDecisions: string[]
}

/**
 * Calculée à la volée, JAMAIS persistée (cf. commentaire de tête) — dépend du
 * `impactKind` ET du `payload` réellement généré (pas d'un lookup statique
 * par impact_kind seul, cf. mandat FIX_REQUIRED Vincent 2026-09-30, problème
 * 3 : la capacité n'est pas uniforme au sein d'un même impact_kind).
 */
export function resolvePlanningApplicationCapability(
  impactKind: PlanningImpactKind,
  payload: PlanningImpactProposalPayload,
): PlanningApplicationCapability {
  switch (impactKind) {
    case 'new':
      return {
        readiness: 'no_application',
        blockingReason: 'new_requires_human_scheduling',
        missingDecisions: ['jour', 'heure', 'équipe', 'durée'],
      }
    case 'modify': {
      const scopeKey = (payload as ModifyPlanningImpactPayload).scopeKey
      if (PLANNING_RELEVANT_MODIFY_SCOPE_KEYS.has(scopeKey)) {
        return {
          readiness: 'partially_representable',
          blockingReason: 'recurring_change_requires_mission_targeting',
          missingDecisions: ['cycle_planning_cible', 'occurrences_a_regenerer'],
        }
      }
      return {
        readiness: 'no_application',
        blockingReason: 'scope_not_planning_related',
        missingDecisions: [],
      }
    }
    case 'suspend':
      return {
        readiness: 'blocked_by_planning_model',
        blockingReason: 'no_native_suspend_resume',
        missingDecisions: ['occurrences_a_annuler', 'mecanisme_de_reprise'],
      }
  }
}
