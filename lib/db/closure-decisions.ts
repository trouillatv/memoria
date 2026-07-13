import 'server-only'

// PL3b — les DÉCISIONS prises sur les conflits de fermeture (mig 205).
//
// Cette couche ne fait qu'écrire et lire. La règle (« quelle date proposer ? »,
// « cette date est-elle acceptable ? ») vit dans lib/planning/conflict-resolution.ts,
// pure et testée.

import { createAdminClient } from '@/lib/supabase/admin'
import type { ConflictDecision } from '@/lib/planning/conflict-resolution'

export interface ClosureDecision {
  interventionId: string
  closureId: string
  decision: ConflictDecision
  movedTo: string | null
  conflictDate: string
  decidedAt: string
}

/** Dégradation gracieuse tant que la mig 205 n'est pas appliquée : sans elle, le
 *  comportement est exactement celui de PL3a (on constate, on ne tranche pas). */
function isMissing(error: { code?: string; message?: string }): boolean {
  return error.code === '42P01' || (error.message ?? '').includes('closure_conflict_decision')
}

/**
 * Les interventions MAINTENUES malgré la fermeture.
 *
 * C'est la lecture chaude : elle court à chaque affichage de la semaine. Sans
 * elle, un conflit déjà tranché se ré-afficherait tous les matins — et le jour
 * où une VRAIE alerte arrive, plus personne ne la lirait.
 */
export async function listKeptInterventionIds(interventionIds: string[]): Promise<Set<string>> {
  if (interventionIds.length === 0) return new Set()

  const { data, error } = await createAdminClient()
    .from('closure_conflict_decision')
    .select('intervention_id')
    .in('intervention_id', interventionIds)
    .eq('decision', 'kept')

  if (error) {
    if (isMissing(error)) return new Set()
    return new Set()
  }
  return new Set(((data ?? []) as Array<{ intervention_id: string }>).map((r) => r.intervention_id))
}

/**
 * Les décisions prises sur un lot d'interventions.
 *
 * C'est ce qui permet au TIROIR de relire la trace : une fois « maintenue », le
 * conflit disparaît — et sans cette lecture, la décision disparaîtrait AVEC lui.
 * On ne peut pas relire ce qu'on n'affiche plus.
 */
export async function listDecisions(
  interventionIds: string[],
): Promise<Record<string, ClosureDecision>> {
  if (interventionIds.length === 0) return {}

  const { data, error } = await createAdminClient()
    .from('closure_conflict_decision')
    .select('intervention_id, closure_id, decision, moved_to, conflict_date, decided_at')
    .in('intervention_id', interventionIds)

  if (error) return {}

  const out: Record<string, ClosureDecision> = {}
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    out[r.intervention_id as string] = {
      interventionId: r.intervention_id as string,
      closureId: r.closure_id as string,
      decision: r.decision as ConflictDecision,
      movedTo: (r.moved_to as string | null) ?? null,
      conflictDate: r.conflict_date as string,
      decidedAt: r.decided_at as string,
    }
  }
  return out
}

/** Ce qui a été décidé sur cette intervention — pour le relire, pas pour le juger. */
export async function getDecision(interventionId: string): Promise<ClosureDecision | null> {
  const { data, error } = await createAdminClient()
    .from('closure_conflict_decision')
    .select('intervention_id, closure_id, decision, moved_to, conflict_date, decided_at')
    .eq('intervention_id', interventionId)
    .maybeSingle()

  if (error || !data) return null
  const r = data as Record<string, unknown>
  return {
    interventionId: r.intervention_id as string,
    closureId: r.closure_id as string,
    decision: r.decision as ConflictDecision,
    movedTo: (r.moved_to as string | null) ?? null,
    conflictDate: r.conflict_date as string,
    decidedAt: r.decided_at as string,
  }
}

/** Trancher. Re-trancher REMPLACE : un changement d'avis n'est pas une faute,
 *  mais il écrase — il n'empile pas. */
export async function recordDecision(input: {
  interventionId: string
  closureId: string
  decision: ConflictDecision
  movedTo: string | null
  conflictDate: string
  userId: string | null
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('closure_conflict_decision')
    .upsert(
      {
        intervention_id: input.interventionId,
        closure_id: input.closureId,
        decision: input.decision,
        moved_to: input.decision === 'moved' ? input.movedTo : null,
        conflict_date: input.conflictDate,
        decided_by: input.userId,
        decided_at: new Date().toISOString(),
      },
      { onConflict: 'intervention_id,closure_id' },
    )
  if (error) throw new Error(error.message)
}
