// DOC-CONTRACT-OS-1B4-C1 — résolution READ-ONLY des cibles Planning
// candidates pour une Planning Impact Proposal donnée (mandat §7) : renvoie
// une LISTE explicite de candidats avec leur statut, JAMAIS une sélection
// automatique — le choix de la cible reste un geste humain (lib/db, UI).
//
// AUCUNE dépendance Supabase/DB — reçoit un inventaire déjà résolu par
// l'appelant (lib/db/planning-impact-application-decisions.ts) : pour chaque
// Mission candidate du même site que l'Engagement, ses rythmes SIMPLE actifs
// (intervention_templates, cycle_id IS NULL, active=true, deleted_at IS NULL)
// et ses ROULEMENTS publiés (planning_cycles.status='published').
//
// Logique dérivée directement de l'invariant d'exclusivité SIMPLE↔ROULEMENT
// (migration 442, plan_integ_simple_cycle_conflict_guard) : une Mission ne
// peut pas avoir un rythme SIMPLE actif ET un cycle publié qui se chevauchent
// en période — c'est cette même règle qui rend un NEW bloqué
// (`blocked_conflicting_source`) sur une Mission dont le roulement est déjà
// publié (créer un nouveau rythme SIMPLE y violerait l'invariant DB).
//
// Point gelé Vincent (migration 449, simple_modify_blocked_check) : MODIFY
// sur une source SIMPLE reste bloqué en C1, quel que soit l'état de la
// décision — `blocked_requires_simple_supersession` ci-dessous. SUSPEND n'est
// PAS concerné par cette restriction (mandat §10 : une fenêtre d'exception ne
// touche pas la structure du rythme, simple ou roulement).

export type PlanningTargetReadiness =
  | 'ready'
  | 'blocked_requires_simple_supersession'
  | 'blocked_conflicting_source'
  | 'blocked_no_target'

export type PlanningTargetBlockingReason =
  | 'mission_inactive'
  | 'no_active_source'
  | 'active_published_cycle_conflict'
  | 'simple_modify_requires_supersession'

export type PlanningTargetCandidate = {
  missionId: string
  missionName: string
  sourceKind: 'simple' | 'cycle' | null
  templateId: string | null
  cycleId: string | null
  readiness: PlanningTargetReadiness
  reason?: PlanningTargetBlockingReason
}

export type ResolvableMission = {
  missionId: string
  missionName: string
  active: boolean
  /** intervention_templates actifs, cycle_id IS NULL, deleted_at IS NULL. */
  activeSimpleTemplateIds: string[]
  /** planning_cycles.status = 'published' pour cette Mission (0 ou 1 attendu
   *  par l'invariant 442 ; tableau conservé par défense, jamais supposé
   *  singleton ici). */
  activePublishedCycleIds: string[]
}

export type ResolvePlanningTargetCandidatesInput = {
  mutationKind: 'new' | 'modify' | 'suspend'
  candidateMissions: ResolvableMission[]
}

export function resolvePlanningTargetCandidates(
  input: ResolvePlanningTargetCandidatesInput,
): PlanningTargetCandidate[] {
  const { mutationKind, candidateMissions } = input
  const candidates: PlanningTargetCandidate[] = []

  for (const mission of candidateMissions) {
    if (!mission.active) {
      candidates.push({
        missionId: mission.missionId,
        missionName: mission.missionName,
        sourceKind: null,
        templateId: null,
        cycleId: null,
        readiness: 'blocked_no_target',
        reason: 'mission_inactive',
      })
      continue
    }

    if (mutationKind === 'new') {
      if (mission.activePublishedCycleIds.length > 0) {
        for (const cycleId of mission.activePublishedCycleIds) {
          candidates.push({
            missionId: mission.missionId,
            missionName: mission.missionName,
            sourceKind: 'cycle',
            templateId: null,
            cycleId,
            readiness: 'blocked_conflicting_source',
            reason: 'active_published_cycle_conflict',
          })
        }
        continue
      }
      candidates.push({
        missionId: mission.missionId,
        missionName: mission.missionName,
        sourceKind: null,
        templateId: null,
        cycleId: null,
        readiness: 'ready',
      })
      continue
    }

    // modify | suspend — la cible doit être un rythme EXISTANT.
    const hasSimple = mission.activeSimpleTemplateIds.length > 0
    const hasCycle = mission.activePublishedCycleIds.length > 0

    if (!hasSimple && !hasCycle) {
      candidates.push({
        missionId: mission.missionId,
        missionName: mission.missionName,
        sourceKind: null,
        templateId: null,
        cycleId: null,
        readiness: 'blocked_no_target',
        reason: 'no_active_source',
      })
      continue
    }

    for (const templateId of mission.activeSimpleTemplateIds) {
      candidates.push({
        missionId: mission.missionId,
        missionName: mission.missionName,
        sourceKind: 'simple',
        templateId,
        cycleId: null,
        readiness: mutationKind === 'modify' ? 'blocked_requires_simple_supersession' : 'ready',
        reason: mutationKind === 'modify' ? 'simple_modify_requires_supersession' : undefined,
      })
    }
    for (const cycleId of mission.activePublishedCycleIds) {
      candidates.push({
        missionId: mission.missionId,
        missionName: mission.missionName,
        sourceKind: 'cycle',
        templateId: null,
        cycleId,
        readiness: 'ready',
      })
    }
  }

  return candidates
}
