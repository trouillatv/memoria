// DOC-CONTRACT-OS-1B4-C1 (GO Vincent 2026-09-30, sur audit 1B4-A/B0/B FINAL
// CLOSED — SHA c6864e85) — modèle pur de la décision humaine d'application
// d'une Planning Impact Proposal (448) à une cible Planning précise.
//
// AUCUNE dépendance Supabase/DB dans ce fichier — reçoit déjà résolus par
// l'appelant : la proposition (448), la cible Planning candidate, l'état
// Planning courant. Cf. migration 449 pour le schéma exact et les 4
// corrections d'architecture actées avant ce lot.
//
// mutation_kind reprend EXACTEMENT PlanningImpactKind
// (lib/engagements/planning-impact-proposal.ts) — jamais un vocabulaire
// parallèle (mandat §11, esprit étendu aux noms de concepts).

import { createHash } from 'node:crypto'
import { canonicalStringify } from '@/lib/knowledge/tracked-point-fingerprint'
import type { PlanningImpactKind, PlanningImpactProposalPayload } from './planning-impact-proposal'
import type { DraftSimpleTemplate } from '@/lib/planning/impact-preview'
import type { DraftCycle } from '@/lib/planning/cycle-preview'

export type MutationKind = PlanningImpactKind

/** NULL en base pour 'new' (aucune cible existante) — jamais représenté ici
 *  par `null` dans un type applicatif : les payloads NEW n'ont simplement
 *  aucun champ target_source_kind. */
export type PlanningTargetSourceKind = 'simple' | 'cycle'

/** Cycle de vie C1 (migration 449) — SANS `failed` (mandat §3). `applied` est
 *  réservé à C2+, jamais atteint par ce lot (contrainte DB
 *  c1_never_applied_check en complément de cette discipline applicative). */
export type DecisionLifecycleStatus = 'draft' | 'ready' | 'applied' | 'cancelled' | 'superseded'

export type NewDecisionPayload = {
  mutationKind: 'new'
  targetMissionId: string
  targetSourceKind: null
  targetTemplateId: null
  targetCycleId: null
  proposalPayload: PlanningImpactProposalPayload
  /** Contenu humain du rythme SIMPLE virtuel à prévisualiser (mandat §9) —
   *  JAMAIS dérivé automatiquement de `proposalPayload.cadence` : la cadence
   *  contractuelle ({count, period}) ne détermine ni le jour, ni l'heure, ni
   *  l'équipe — ce sont des décisions humaines, saisies ici pour l'aperçu et
   *  reprises telles quelles par une future Apply (C2+). `missionId` doit
   *  toujours valoir `targetMissionId`. */
  draftSimpleTemplate: DraftSimpleTemplate
}

export type ModifyCycleDecisionPayload = {
  mutationKind: 'modify'
  targetMissionId: string
  targetSourceKind: 'cycle'
  targetTemplateId: null
  targetCycleId: string
  proposalPayload: PlanningImpactProposalPayload
  /** Grille APRÈS proposée par l'humain (mandat §8) — la grille AVANT n'est
   *  jamais stockée ici : elle se relit en direct depuis `target_cycle_id`
   *  (lib/db/planning-cycles.ts, getCycle) à chaque prévisualisation, ce qui
   *  est précisément ce que `planning_state_fingerprint` sert à surveiller
   *  (mandat §6/§12) — un `after` figé ici, comparé à un `before` toujours
   *  relu en direct. `missionId`/`cycleLengthWeeks` etc. de `draftCycleAfter`
   *  peuvent différer du cycle courant (ex. changement de longueur de cycle
   *  pour représenter la nouvelle cadence). */
  draftCycleAfter: DraftCycle
}

/** MODIFY sur une source SIMPLE reste BLOQUÉ en C1 (point gelé Vincent,
 *  contrainte DB simple_modify_blocked_check) — ce payload ne peut jamais
 *  atteindre le statut 'ready' ni 'applied', cf.
 *  lib/planning/target-resolution.ts (`blocked_requires_simple_supersession`). */
export type ModifySimpleBlockedDecisionPayload = {
  mutationKind: 'modify'
  targetMissionId: string
  targetSourceKind: 'simple'
  targetTemplateId: string
  targetCycleId: null
  proposalPayload: PlanningImpactProposalPayload
}

export type SuspendDecisionPayload = {
  mutationKind: 'suspend'
  targetMissionId: string
  targetSourceKind: PlanningTargetSourceKind
  targetTemplateId: string | null
  targetCycleId: string | null
  proposalPayload: PlanningImpactProposalPayload
}

export type PlanningApplicationDecisionPayload =
  | NewDecisionPayload
  | ModifyCycleDecisionPayload
  | ModifySimpleBlockedDecisionPayload
  | SuspendDecisionPayload

export type ApplicationFingerprintInput = {
  contractEffectId: string
  planningImpactProposalId: string
  proposalVersionAtDecision: number
  mutationKind: MutationKind
  targetMissionId: string
  targetSourceKind: PlanningTargetSourceKind | null
  targetTemplateId: string | null
  targetCycleId: string | null
  decisionPayload: PlanningApplicationDecisionPayload
}

/** hash(...) — EXCLUT tout champ volatil (id/status/timestamps/decided_by),
 *  cf. commentaire de la colonne application_fingerprint (migration 449).
 *  Réutilise canonicalStringify, seul mécanisme de hachage déterministe du
 *  dépôt (même discipline que computePlanningImpactProposalFingerprint). */
export function computeApplicationFingerprint(input: ApplicationFingerprintInput): string {
  return createHash('sha256').update(canonicalStringify(input)).digest('hex')
}

/** current = la décision porte sur la version la plus récente et non
 *  dismissed de la proposition 448. stale = la proposition a changé de
 *  version depuis la décision (le contrat a évolué). dismissed = la
 *  proposition a été explicitement écartée depuis. Calculée à la LECTURE,
 *  jamais persistée (mandat §5/§12) — un décalage ne se corrige jamais tout
 *  seul, il doit être vu puis retraité par un humain. */
export type ContractFreshness = 'current' | 'stale' | 'dismissed'

export type ContractFreshnessInput = {
  proposalVersionAtDecision: number
  currentProposalVersion: number
  currentProposalStatus: 'proposed' | 'dismissed'
}

export function computeContractFreshness(input: ContractFreshnessInput): ContractFreshness {
  if (input.currentProposalStatus === 'dismissed') return 'dismissed'
  if (input.currentProposalVersion !== input.proposalVersionAtDecision) return 'stale'
  return 'current'
}
