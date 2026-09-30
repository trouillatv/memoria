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
import type { PlanningImpactKind, PlanningImpactProposalPayload, SuspendPlanningImpactPayload } from './planning-impact-proposal'
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

/** Version du schéma de calcul de l'empreinte d'application (mandat FIX 5) —
 *  incrémenter à chaque changement de la forme de `ApplicationFingerprintInput`
 *  ou de la logique de `computeApplicationFingerprint`, pour qu'une décision
 *  calculée sous un ancien schéma ne soit jamais confondue avec une décision
 *  identique calculée sous le schéma courant. */
export const APPLICATION_DECISION_SCHEMA_VERSION = 1

export type NewDecisionPayload = {
  mutationKind: 'new'
  targetMissionId: string
  targetSourceKind: null
  targetTemplateId: null
  targetCycleId: null
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
}

export type SuspendDecisionPayload = {
  mutationKind: 'suspend'
  targetMissionId: string
  targetSourceKind: PlanningTargetSourceKind
  targetTemplateId: string | null
  targetCycleId: string | null
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
  const versioned = { schemaVersion: APPLICATION_DECISION_SCHEMA_VERSION, ...input }
  return createHash('sha256').update(canonicalStringify(versioned)).digest('hex')
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

// ── Canonicalisation preview/persistance (mandat ROUND 2 FIX 1) ─────────────
// previewApplication et createDraftDecision doivent construire EXACTEMENT la
// même décision canonique à partir d'un decisionPayload brut client — jamais
// deux chemins divergents (preview sur payload brut, persistance canonisée).
// Les dates canoniques viennent TOUJOURS de proposalPayload (contrat), jamais
// du payload humain, qui ne fixe que le contenu (jour/heure/équipe/grille).
export type NormalizeDecisionResult =
  | { ok: true; payload: PlanningApplicationDecisionPayload }
  | { ok: false; error: 'target_mission_mismatch' }

export function normalizeDecisionAgainstProposal(
  decisionPayload: PlanningApplicationDecisionPayload,
  proposalPayload: PlanningImpactProposalPayload,
): NormalizeDecisionResult {
  if (decisionPayload.mutationKind === 'new') {
    if (decisionPayload.draftSimpleTemplate.missionId !== decisionPayload.targetMissionId) {
      return { ok: false, error: 'target_mission_mismatch' }
    }
    const { effectiveFrom, effectiveTo } = proposalPayload
    return {
      ok: true,
      payload: {
        ...decisionPayload,
        draftSimpleTemplate: {
          ...decisionPayload.draftSimpleTemplate,
          startsOn: effectiveFrom ?? decisionPayload.draftSimpleTemplate.startsOn,
          endsOn: effectiveTo,
        },
      },
    }
  }
  if (decisionPayload.mutationKind === 'modify' && decisionPayload.targetSourceKind === 'cycle') {
    if (decisionPayload.draftCycleAfter.missionId !== decisionPayload.targetMissionId) {
      return { ok: false, error: 'target_mission_mismatch' }
    }
    const { effectiveFrom, effectiveTo } = proposalPayload
    return {
      ok: true,
      payload: {
        ...decisionPayload,
        draftCycleAfter: {
          ...decisionPayload.draftCycleAfter,
          startsOn: effectiveFrom ?? decisionPayload.draftCycleAfter.startsOn,
          endsOn: effectiveTo,
        },
      },
    }
  }
  return { ok: true, payload: decisionPayload }
}

// ── Fenêtre de suspension contractuelle (mandat ROUND 2 FIX 1) ──────────────
// La fenêtre suspendue vient EXCLUSIVEMENT du contrat (proposalPayload) —
// from/to reçus par previewApplication restent une fenêtre d'AFFICHAGE,
// jamais la définition de la suspension elle-même. Résultat = intersection
// entre la fenêtre contractuelle et la fenêtre d'affichage ; `null` si vide.
export function computeSuspensionWindow(
  proposalPayload: SuspendPlanningImpactPayload,
  displayFrom: string,
  displayTo: string,
): { from: string; to: string } | null {
  const contractualFrom = proposalPayload.effectiveFrom
  const contractualTo = proposalPayload.effectiveTo ?? proposalPayload.resumeOn ?? null
  const from = contractualFrom !== null && contractualFrom > displayFrom ? contractualFrom : displayFrom
  const to = contractualTo === null ? displayTo : contractualTo < displayTo ? contractualTo : displayTo
  if (from > to) return null
  return { from, to }
}

// ── Couverture/chevauchement temporel (mandat ROUND 2 FIX 2/3) ──────────────
// coversDate = couverture ponctuelle (correct pour MODIFY/SUSPEND : la cible
// doit couvrir la date d'effet). overlapsPeriod = chevauchement d'intervalle
// (nécessaire pour NEW : un nouveau rythme peut entrer en conflit avec un
// cycle existant sans que celui-ci "couvre" la date de départ du nouveau).
// Toutes les bornes sont des chaînes ISO 'YYYY-MM-DD', comparables lexicalement.
export function coversDate(startsOn: string, endsOn: string | null, date: string | null): boolean {
  return date === null || (startsOn <= date && (endsOn === null || endsOn >= date))
}

export function overlapsPeriod(
  startsOn: string,
  endsOn: string | null,
  periodFrom: string | null,
  periodTo: string | null,
): boolean {
  if (periodFrom === null) return true
  const startsBeforePeriodEnds = periodTo === null || startsOn <= periodTo
  const endsAfterPeriodStarts = endsOn === null || endsOn >= periodFrom
  return startsBeforePeriodEnds && endsAfterPeriodStarts
}

// ── Éligibilité serveur de la cible (mandat ROUND 2 FIX 3) ──────────────────
// Invariant serveur, jamais délégué au seul fingerprint : reçoit les
// entités DÉJÀ résolues et confirmées existantes par l'appelant (getCycle/
// getTemplate/mission déjà fetchés) — ne fait AUCUN accès DB elle-même, ne
// distingue jamais "n'existe pas" (reste target_not_found côté appelant) de
// "existe mais inéligible" (seul cas couvert ici, target_not_eligible).
export type TargetEligibilityInput = {
  mutationKind: MutationKind
  targetSourceKind: PlanningTargetSourceKind | null
  engagementId: string
  effectiveFrom: string | null
  effectiveTo: string | null
  mission: { active: boolean; engagementIds: string[] | null }
  simpleTemplate?: { active: boolean; startsOn: string; endsOn: string | null } | null
  publishedCycle?: { status: string; startsOn: string; endsOn: string | null } | null
  newMissionCycles?: Array<{ startsOn: string; endsOn: string | null }>
}

export function validateTargetEligibility(input: TargetEligibilityInput): boolean {
  if (!input.mission.active) return false

  if (input.mutationKind === 'new') {
    const hasConflict = (input.newMissionCycles ?? []).some((cycle) =>
      overlapsPeriod(cycle.startsOn, cycle.endsOn, input.effectiveFrom, input.effectiveTo),
    )
    return !hasConflict
  }

  if (!(input.mission.engagementIds ?? []).includes(input.engagementId)) return false

  if (input.targetSourceKind === 'simple') {
    if (!input.simpleTemplate || !input.simpleTemplate.active) return false
    return coversDate(input.simpleTemplate.startsOn, input.simpleTemplate.endsOn, input.effectiveFrom)
  }

  if (input.targetSourceKind === 'cycle') {
    if (!input.publishedCycle || input.publishedCycle.status !== 'published') return false
    return coversDate(input.publishedCycle.startsOn, input.publishedCycle.endsOn, input.effectiveFrom)
  }

  return false
}
