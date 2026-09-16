import 'server-only'

// P0-B (stabilisation post-2-PV, arbitrage Vincent 2026-09-17) — réconciliation
// post-CBO des Actions longitudinales.
//
// Constat : canonical_business_object (CBO) identifie déjà correctement qu'une
// Action issue d'un PV et une Action issue d'un PV ultérieur représentent la
// même obligation (déterministe ET llm — cf. audit stabilisation Dumbéa Mall).
// Mais materialize_historical_visit() insère une ligne site_actions par
// proposition, sans vérifier l'existence d'une Action déjà membre du même CBO.
//
// Doctrine : une occurrence documentaire peut créer une proposition, mais une
// fois que deux propositions sont reconnues membres du même CBO, elles ne
// laissent jamais deux Actions opérationnelles actives pour la même obligation.
// La plus ancienne reste ouverte (gagnante) ; les autres deviennent superseded
// via fn_supersede_action_by_cbo (mig 413) — jamais DELETE, jamais perte de la
// trace d'occurrence (report_id, document_proposal_materialization inchangés).
//
// Portée volontairement étroite : seules les Actions encore status IN
// ('open','planned') ET superseded_by IS NULL entrent en concurrence. Une
// Action déjà 'done' n'est jamais touchée ici — la réapparition documentaire
// d'une obligation close relève de la divergence documentaire existante
// (C2A native_completed/reopened), hors périmètre de ce module.
//
// Idempotent : rejouer sur un groupe déjà réconcilié ne change rien (les
// perdants ont déjà status='cancelled', donc exclus des candidats).

import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface ReconciliationCandidateAction {
  id: string
  createdAt: string
  status: 'open' | 'planned' | 'done' | 'cancelled'
  supersededBy: string | null
}

export interface ReconciliationPlan {
  winnerId: string
  loserIds: string[]
}

/**
 * Logique pure, sans I/O : parmi les Actions d'un même CBO, détermine laquelle
 * reste ouverte (la plus ancienne, tie-break par id) et lesquelles doivent être
 * réconciliées. Retourne null si aucune réconciliation n'est nécessaire (0 ou 1
 * candidat actif). Même patron de tri que chooseExactGuardTarget
 * (canonical-business-object-attach.ts) : created_at puis id, déterministe.
 */
export function selectActionReconciliationPlan(
  actions: ReconciliationCandidateAction[],
): ReconciliationPlan | null {
  const candidates = actions.filter(
    (a) => (a.status === 'open' || a.status === 'planned') && a.supersededBy === null,
  )
  if (candidates.length <= 1) return null

  const sorted = [...candidates].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )
  const [winner, ...losers] = sorted
  return { winnerId: winner.id, loserIds: losers.map((a) => a.id) }
}

function log(msg: string) {
  console.log(`[action-cbo-reconciliation] ${msg}`)
}
function logError(msg: string, err: unknown) {
  console.error(`[action-cbo-reconciliation] ${msg}`, err)
}

async function reconcileOneCanonicalBusinessObject(
  sb: AdminClient,
  canonicalBusinessObjectId: string,
): Promise<number> {
  const { data: members } = await sb
    .from('canonical_business_object_member')
    .select('member_entity_id')
    .eq('canonical_business_object_id', canonicalBusinessObjectId)
    .eq('member_entity_type', 'site_action')
  const actionIds = [...new Set((members ?? []).map((m) => m.member_entity_id as string))]
  if (actionIds.length <= 1) return 0

  const { data: rows } = await sb
    .from('site_actions')
    .select('id, created_at, status, superseded_by')
    .in('id', actionIds)
  const actions: ReconciliationCandidateAction[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    status: r.status as ReconciliationCandidateAction['status'],
    supersededBy: r.superseded_by as string | null,
  }))

  const plan = selectActionReconciliationPlan(actions)
  if (!plan) return 0

  let reconciled = 0
  for (const loserId of plan.loserIds) {
    const { error } = await sb.rpc('fn_supersede_action_by_cbo', {
      p_loser_id: loserId,
      p_winner_id: plan.winnerId,
      p_actor_id: null,
    })
    if (error) {
      logError(`fn_supersede_action_by_cbo a échoué cbo=${canonicalBusinessObjectId} loser=${loserId}`, error)
      continue
    }
    reconciled += 1
  }
  return reconciled
}

/**
 * Point d'entrée appelé depuis le pipeline de post-traitement d'import
 * historique, juste après attachHistoricalReportEntitiesToCanonicalBusinessObjects
 * (les Actions du rapport viennent d'obtenir leur rattachement CBO). Ne
 * réconcilie que les CBO effectivement touchés par CE rapport — les autres
 * groupes CBO du chantier sont laissés pour leur propre passage (idempotent,
 * rejouable sans effet si déjà stable).
 *
 * Best-effort : une panne ici ne fait jamais échouer l'import historique.
 */
export async function reconcileActionsByCanonicalBusinessObjectForReport(params: {
  siteReportId: string
}): Promise<{ groupsReconciled: number; actionsSuperseded: number }> {
  const { siteReportId } = params
  try {
    const sb = createAdminClient()

    const { data: reportActions } = await sb
      .from('site_actions')
      .select('id')
      .eq('report_id', siteReportId)
    const reportActionIds = (reportActions ?? []).map((r) => r.id as string)
    if (reportActionIds.length === 0) return { groupsReconciled: 0, actionsSuperseded: 0 }

    const { data: members } = await sb
      .from('canonical_business_object_member')
      .select('canonical_business_object_id')
      .eq('member_entity_type', 'site_action')
      .in('member_entity_id', reportActionIds)
    const cboIds = [...new Set((members ?? []).map((m) => m.canonical_business_object_id as string))]
    if (cboIds.length === 0) return { groupsReconciled: 0, actionsSuperseded: 0 }

    let groupsReconciled = 0
    let actionsSuperseded = 0
    for (const cboId of cboIds) {
      const superseded = await reconcileOneCanonicalBusinessObject(sb, cboId)
      if (superseded > 0) {
        groupsReconciled += 1
        actionsSuperseded += superseded
      }
    }
    if (actionsSuperseded > 0) {
      log(`siteReportId=${siteReportId} groupes=${groupsReconciled} actions_superseded=${actionsSuperseded}`)
    }
    return { groupsReconciled, actionsSuperseded }
  } catch (e) {
    logError(`réconciliation non bloquante siteReportId=${siteReportId}`, e)
    return { groupsReconciled: 0, actionsSuperseded: 0 }
  }
}
