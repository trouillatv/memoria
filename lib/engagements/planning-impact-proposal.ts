// DOC-CONTRACT-OS-1B4-B (mandat Vincent 2026-09-30, sur audit 1B4-A FINAL
// CLOSED — GO_1B4_B, HOLD_1B4_C) — moteur pur de construction des
// Propositions d'impact Planning à partir d'un effet contractuel matérialisé
// (engagement_contract_effects, migration 445/446/447).
//
// Contraintes d'architecture (mandat, non négociables, même discipline que
// resolve-contract-state.ts) :
//   - AUCUNE dépendance Supabase/DB — reçoit l'effet (et, pour MODIFY/SUSPEND,
//     le contexte contractuel déjà résolu par l'appelant : valeur de portée
//     précédente, cadence structurée antérieure) déjà résolus par l'appelant.
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
//
// GAP RÉSOLU (mandat GO Vincent 2026-09-30, « STRUCTURED PLANNING RELEVANCE »,
// FIX_REQUIRED 2e revue « REMOVE OPAQUE SCHEDULE PATH ») — l'audit FIX C
// (READ-ONLY) avait confirmé qu'aucun champ structuré du domaine Engagement
// ne permettait de distinguer un NEW/SUSPEND Planning-relevant d'un
// NEW/SUSPEND purement documentaire. La brique cadence structurée
// (DOC-CONTRACT-OS-1B4-B0, effect_payload.cadence = { count, period })
// fournit désormais cette preuve : NEW et MODIFY(frequency) ne génèrent une
// proposition QUE si une cadence structurée valide est connue ; SUSPEND ne
// génère une proposition QUE si l'Engagement cible possédait une cadence
// structurée juste avant `startsOn`. AUCUNE dérivation depuis
// `description`/`frequency_raw`/`category`/`measurable` — un contrat sans
// cadence structurée reste honnêtement hors périmètre Planning aujourd'hui.
// MODIFY sur tout scope_key AUTRE que `frequency` (y compris `schedule`, qui
// n'a aucun modèle contractuel structuré canonique aujourd'hui) ne génère
// JAMAIS de proposition — un payload opaque/textuel ne constitue plus une
// preuve Planning suffisante dans ce lot.

import { createHash } from 'node:crypto'
import { canonicalStringify } from '@/lib/knowledge/tracked-point-fingerprint'
import { extractCadenceFromEffectPayload, type ContractCadence } from './contract-cadence'
import type { ContractTemporality } from './contract-effect'
import type { EngagementContractEffectRow, MaterializedContractEffect } from './resolve-contract-state'

export type PlanningImpactKind = Extract<MaterializedContractEffect, 'new' | 'modify' | 'suspend'>

// Seul scope_key dont la MODIFICATION est aujourd'hui Planning-relevant :
// `frequency`, seul à posséder un modèle contractuel structuré (cadence).
// Tout autre scope_key (ex. "quantity", "access", "equipment", "schedule")
// est un fait contractuel réel mais SANS impact Planning proposé — cf.
// mandat FIX_REQUIRED Vincent 2026-09-30, problème 4 (« effet contractuel ≠
// proposition Planning ») et 2e revue (« REMOVE OPAQUE SCHEDULE PATH » :
// `schedule` n'a reçu aucun modèle structuré canonique, un payload textuel
// ne suffit plus). Pas d'enum DB, ajustable sans migration si un modèle
// structuré `schedule` est défini plus tard.
export const PLANNING_RELEVANT_MODIFY_SCOPE_KEYS: ReadonlySet<string> = new Set(['frequency'])

export type NewPlanningImpactPayload = {
  operation: 'new'
  temporality: ContractTemporality
  effectiveFrom: string | null
  effectiveTo: string | null
  scopeKey: string
  cadence: ContractCadence
}

/** MODIFY sur `frequency` — seul cas MODIFY dont la preuve Planning est
 *  structurée (cadence avant/après), cf. mandat GO 1B4-B, règle 2. */
export type ModifyFrequencyPlanningImpactPayload = {
  operation: 'change_frequency'
  scopeKey: 'frequency'
  effectiveFrom: string | null
  effectiveTo: string | null
  fromCadence: ContractCadence | null
  toCadence: ContractCadence
}

/** Seul cas MODIFY produisant une proposition dans ce lot (cf.
 *  PLANNING_RELEVANT_MODIFY_SCOPE_KEYS) — alias conservé pour lisibilité des
 *  appelants qui manipulent un impactKind='modify' déjà su Planning-relevant. */
export type ModifyPlanningImpactPayload = ModifyFrequencyPlanningImpactPayload

export type SuspendPlanningImpactPayload = {
  operation: 'suspend'
  effectiveFrom: string
  effectiveTo: string | null
  resumeOn: string | null
  // Cadence contractuelle connue au jour civil précédant `effectiveFrom` —
  // dérivée par l'appelant via resolveContractCadenceAtDate, JAMAIS écrite
  // dans l'effet SUSPEND lui-même (mandat GO 1B4-B, règle 3).
  priorCadence: ContractCadence
}

export type PlanningImpactProposalPayload =
  | NewPlanningImpactPayload
  | ModifyFrequencyPlanningImpactPayload
  | SuspendPlanningImpactPayload

export type BuildPlanningImpactProposalContext = {
  /** Uniquement pertinent pour MODIFY `frequency` (cadence avant bascule) et
   *  SUSPEND (cadence connue au jour civil précédant `startsOn`) — déjà
   *  résolue par l'appelant via `resolveContractCadenceAtDate`. `null`/
   *  `undefined` si aucune cadence structurée n'est connue à cette date. */
  priorCadence?: ContractCadence | null
}

/**
 * Construit la proposition d'impact Planning d'un effet contractuel
 * matérialisé. Rend `null` pour CONFIRM (provenance pure, jamais un impact
 * Planning — doctrine 8 de resolve-contract-state.ts) et, depuis le mandat GO
 * 1B4-B, pour tout NEW/MODIFY(frequency)/SUSPEND dont la preuve Planning
 * structurée (cadence) est absente — cf. commentaire de tête « GAP RÉSOLU ».
 *
 * MODIFY sur un `scopeKey` hors PLANNING_RELEVANT_MODIFY_SCOPE_KEYS rend
 * `null` : l'effet contractuel est réel (matérialisé dans
 * engagement_contract_effects) mais n'a aucun impact Planning à proposer.
 */
export function buildPlanningImpactProposalPayload(
  effect: EngagementContractEffectRow,
  context?: BuildPlanningImpactProposalContext,
): PlanningImpactProposalPayload | null {
  switch (effect.effect) {
    case 'new': {
      const cadence = extractCadenceFromEffectPayload(effect.effectPayload)
      if (!cadence) return null
      return {
        operation: 'new',
        temporality: effect.temporality,
        effectiveFrom: effect.startsOn,
        effectiveTo: effect.endsOn,
        scopeKey: effect.scopeKey,
        cadence,
      }
    }
    case 'modify': {
      if (!PLANNING_RELEVANT_MODIFY_SCOPE_KEYS.has(effect.scopeKey)) return null
      const toCadence = extractCadenceFromEffectPayload(effect.effectPayload)
      if (!toCadence) return null
      return {
        operation: 'change_frequency',
        scopeKey: 'frequency',
        effectiveFrom: effect.startsOn,
        effectiveTo: effect.endsOn,
        fromCadence: context?.priorCadence ?? null,
        toCadence,
      }
    }
    case 'suspend': {
      const priorCadence = context?.priorCadence ?? null
      if (!priorCadence) return null
      return {
        operation: 'suspend',
        // CHECK engagement_contract_effects_suspend_starts_check (445) garantit
        // startsOn non nul pour tout effet SUSPEND matérialisé.
        effectiveFrom: effect.startsOn as string,
        effectiveTo: effect.endsOn,
        resumeOn: effect.resumeOn,
        priorCadence,
      }
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
// cycle publié ; intervention_templates pour une création) mais requiert une
// traduction humaine (quelle Mission cible, jour/heure/équipe, quels
// slots/ancre/longueur de cycle) — jamais une application automatique. NEW
// est ici (verdict 1B4-A FINAL CLOSED : le Planning sait représenter une
// récurrence bornée, ce qui manque est la décision humaine, pas le modèle).
// BLOCKED_BY_PLANNING_MODEL : aucun mécanisme natif n'existe aujourd'hui pour
// ce cas, quelle que soit la richesse de la proposition.
// (NO_APPLICATION supprimé avec le fix « REMOVE OPAQUE SCHEDULE PATH » —
// buildPlanningImpactProposalPayload ne produit plus jamais de payload pour
// un MODIFY non Planning-relevant, cf. PLANNING_RELEVANT_MODIFY_SCOPE_KEYS ;
// ce statut n'était donc plus jamais atteignable par resolvePlanningApplicationCapability.)
export type PlanningApplicationReadiness = 'partially_representable' | 'blocked_by_planning_model'

export type PlanningApplicationBlockingReason =
  | 'new_requires_human_scheduling'
  | 'recurring_change_requires_mission_targeting'
  | 'no_native_suspend_resume'

export type PlanningApplicationCapability = {
  readiness: PlanningApplicationReadiness
  blockingReason: PlanningApplicationBlockingReason
  missingDecisions: string[]
}

/**
 * Calculée à la volée, JAMAIS persistée (cf. commentaire de tête). Ne dépend
 * plus que de `impactKind` depuis le fix « REMOVE OPAQUE SCHEDULE PATH » :
 * chaque impactKind atteignant une proposition a désormais exactement une
 * forme de payload possible (buildPlanningImpactProposalPayload ne produit
 * plus jamais qu'un seul shape par impactKind, cf.
 * PLANNING_RELEVANT_MODIFY_SCOPE_KEYS) — `payload` reste dans la signature
 * pour ne pas casser les appelants, mais n'est plus inspecté.
 */
export function resolvePlanningApplicationCapability(
  impactKind: PlanningImpactKind,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature conservée pour les appelants (lib/db, tests OS15 gelés), cf. commentaire ci-dessus.
  payload: PlanningImpactProposalPayload,
): PlanningApplicationCapability {
  switch (impactKind) {
    case 'new':
      return {
        readiness: 'partially_representable',
        blockingReason: 'new_requires_human_scheduling',
        missingDecisions: ['jour', 'heure', 'équipe', 'durée'],
      }
    case 'modify':
      // Un MODIFY présent dans les Planning Impact Proposals est nécessairement
      // un MODIFY frequency structuré (buildPlanningImpactProposalPayload ne
      // produit jamais de payload pour un autre scope_key, cf.
      // PLANNING_RELEVANT_MODIFY_SCOPE_KEYS).
      return {
        readiness: 'partially_representable',
        blockingReason: 'recurring_change_requires_mission_targeting',
        missingDecisions: ['cycle_planning_cible', 'occurrences_a_regenerer'],
      }
    case 'suspend':
      return {
        readiness: 'blocked_by_planning_model',
        blockingReason: 'no_native_suspend_resume',
        missingDecisions: ['occurrences_a_annuler', 'mecanisme_de_reprise'],
      }
  }
}
