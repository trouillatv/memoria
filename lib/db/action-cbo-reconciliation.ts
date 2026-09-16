import 'server-only'

// P0-B / P0-B.1 (stabilisation post-2-PV, arbitrage Vincent 2026-09-17) —
// réconciliation post-CBO des Actions longitudinales.
//
// Constat : canonical_business_object (CBO) identifie déjà correctement qu'une
// Action issue d'un PV et une Action issue d'un PV ultérieur représentent la
// même obligation (déterministe ET llm — cf. audit stabilisation Dumbéa Mall).
// Mais materialize_historical_visit() insère une ligne site_actions par
// proposition, sans jamais vérifier l'existence d'une Action déjà membre du
// même CBO.
//
// P0-B.1 distingue explicitement deux questions (arbitrage Vincent) :
//   1. CBO = identité : « ces deux lignes parlent-elles de la même obligation ? »
//   2. Réconciliation = état opérationnel : « quelle est la meilleure
//      représentation courante de cette obligation ? » — jamais un tri
//      « le plus ancien gagne » qui écraserait silencieusement une donnée plus
//      riche ou plus récente.
//
// Doctrine (mirror exact de la doctrine SQL, migration 413) :
//   · Identité durable = la ligne la plus ancienne parmi les Actions encore
//     actives du groupe (status IN 'open'|'planned'|'done' ET supersededBy
//     IS NULL) — tie-break par id. Jamais changée.
//   · Si la durable est déjà 'done' : AUCUNE fusion, quel que soit l'état des
//     autres membres — jamais de réouverture automatique par ce module (cas C,
//     DONE → OPEN plus tard = divergence à arbitrer humainement, hors
//     périmètre de ce module ; cf. cbo-lifecycle-reducer.ts, non branché ici).
//   · Sinon, le statut ne progresse JAMAIS qu'en avant sur l'échelle
//     planned(0) < open(1) < done(2) — jamais de recul. La durable adopte le
//     statut le plus avancé parmi tous les membres actifs du groupe (cas A/B/D).
//   · Champs simples (titre, corps, entreprise assignée, réserve liée) : ne
//     sont comblés que si vides côté durable — jamais écrasés.
//   · Contact assigné et échéance sont protégés plus fort : si un humain les a
//     explicitement retirés (événement `unassigned` / `due_date_changed` vers
//     null au journal), un doublon ne peut jamais les re-remplir silencieusement.
//   · « Une donnée humaine explicite ne doit jamais être écrasée silencieusement
//     par une valeur issue d'un import. »
//
// Écriture atomique et concurrente : une seule RPC par groupe
// (fn_apply_action_cbo_merge, migration 413) verrouille durable + perdants EN
// UNE instruction triée par id avant toute lecture/écriture — jamais de boucle
// d'appels RPC séparés par perdant.
//
// Idempotent : rejouer sur un groupe déjà réconcilié ne change rien (les
// perdants ont déjà status='cancelled', donc exclus des candidats ; une
// durable déjà 'done' bloque toute nouvelle fusion).

import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface ReconciliationCandidateAction {
  id: string
  createdAt: string
  status: 'open' | 'planned' | 'done' | 'cancelled'
  supersededBy: string | null
  title: string | null
  body: string | null
  assignedTo: string | null
  assignedContactId: string | null
  assignedCompanyId: string | null
  dueDate: string | null
  dueDateStatus: 'explicit' | 'estimated' | null
  reserveId: string | null
  doneAt: string | null
  completedComment: string | null
  completedPhotoPath: string | null
  /** Un événement `unassigned` existe déjà pour cette action (retrait humain explicite). */
  contactExplicitlyCleared: boolean
  /** Un événement `due_date_changed` vers null existe déjà pour cette action. */
  dueDateExplicitlyCleared: boolean
}

/** Champ par champ, patch jsonb envoyé à fn_apply_action_cbo_merge (clés camelCase, miroir exact du SQL). */
export type ActionCboMergePatch = Partial<{
  title: string
  body: string
  assignedTo: string
  assignedContactId: string
  assignedCompanyId: string
  dueDate: string
  dueDateStatus: 'explicit' | 'estimated'
  reserveId: string
  status: 'open' | 'planned' | 'done'
  doneAt: string
  completedComment: string
  completedPhotoPath: string
}>

export type ReconciliationOutcome =
  | { kind: 'none' }
  | { kind: 'blocked_done_durable'; durableId: string; pendingActiveIds: string[] }
  | { kind: 'merge'; durableId: string; loserIds: string[]; patch: ActionCboMergePatch }

type ActiveStatus = 'planned' | 'open' | 'done'
type ActiveCandidateAction = ReconciliationCandidateAction & { status: ActiveStatus }

const STATUS_RANK: Record<ActiveStatus, number> = { planned: 0, open: 1, done: 2 }

function isActiveCandidate(a: ReconciliationCandidateAction): a is ActiveCandidateAction {
  return a.status !== 'cancelled' && a.supersededBy === null
}

/**
 * Logique pure, sans I/O : parmi les Actions d'un même CBO, détermine l'identité
 * durable et le meilleur état opérationnel courant (doctrine ci-dessus). Miroir
 * exact des règles appliquées par fn_apply_action_cbo_merge (migration 413) —
 * toute divergence entre les deux doit être traitée comme un bug.
 */
export function planActionCboReconciliation(
  actions: ReconciliationCandidateAction[],
): ReconciliationOutcome {
  const active = actions.filter(isActiveCandidate)
  if (active.length <= 1) return { kind: 'none' }

  const sorted = [...active].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )
  const [durable, ...others] = sorted

  if (durable.status === 'done') {
    return { kind: 'blocked_done_durable', durableId: durable.id, pendingActiveIds: others.map((a) => a.id) }
  }

  const patch: ActionCboMergePatch = {}

  // Échelle de statut : ne progresse jamais qu'en avant.
  let targetStatus: ActiveStatus = durable.status
  for (const other of others) {
    if (STATUS_RANK[other.status] > STATUS_RANK[targetStatus]) targetStatus = other.status
  }
  if (targetStatus !== durable.status) {
    patch.status = targetStatus
    if (targetStatus === 'done') {
      const doneSource = others.find((o) => o.status === 'done')
      if (doneSource) {
        if (doneSource.doneAt) patch.doneAt = doneSource.doneAt
        if (doneSource.completedComment) patch.completedComment = doneSource.completedComment
        if (doneSource.completedPhotoPath) patch.completedPhotoPath = doneSource.completedPhotoPath
      }
    }
  }

  // Champs simples : comblés seulement si vides côté durable (jamais écrasés).
  if (!durable.title) {
    const source = others.find((o) => o.title)
    if (source?.title) patch.title = source.title
  }
  if (!durable.body) {
    const source = others.find((o) => o.body)
    if (source?.body) patch.body = source.body
  }
  if (!durable.assignedTo) {
    const source = others.find((o) => o.assignedTo)
    if (source?.assignedTo) patch.assignedTo = source.assignedTo
  }
  if (!durable.assignedCompanyId) {
    const source = others.find((o) => o.assignedCompanyId)
    if (source?.assignedCompanyId) patch.assignedCompanyId = source.assignedCompanyId
  }
  if (!durable.reserveId) {
    const source = others.find((o) => o.reserveId)
    if (source?.reserveId) patch.reserveId = source.reserveId
  }

  // Contact assigné : protection renforcée — un retrait humain explicite bloque tout remplissage.
  if (!durable.assignedContactId && !durable.contactExplicitlyCleared) {
    const source = others.find((o) => o.assignedContactId)
    if (source?.assignedContactId) patch.assignedContactId = source.assignedContactId
  }

  // Échéance : même protection renforcée.
  if (!durable.dueDate && !durable.dueDateExplicitlyCleared) {
    const source = others.find((o) => o.dueDate)
    if (source?.dueDate) {
      patch.dueDate = source.dueDate
      if (source.dueDateStatus) patch.dueDateStatus = source.dueDateStatus
    }
  }

  return { kind: 'merge', durableId: durable.id, loserIds: others.map((a) => a.id), patch }
}

function log(msg: string) {
  console.log(`[action-cbo-reconciliation] ${msg}`)
}
function logError(msg: string, err: unknown) {
  console.error(`[action-cbo-reconciliation] ${msg}`, err)
}

async function loadCandidateActions(
  sb: AdminClient,
  actionIds: string[],
): Promise<ReconciliationCandidateAction[]> {
  const { data: rows } = await sb
    .from('site_actions')
    .select(
      'id, created_at, status, superseded_by, title, body, assigned_to, assigned_contact_id, assigned_company_id, due_date, due_date_status, reserve_id, done_at, completed_comment, completed_photo_path',
    )
    .in('id', actionIds)

  const { data: eventRows } = await sb
    .from('site_action_events')
    .select('action_id, kind, after_value')
    .in('action_id', actionIds)
    .in('kind', ['unassigned', 'due_date_changed'])

  const contactCleared = new Set<string>()
  const dueDateCleared = new Set<string>()
  for (const e of (eventRows ?? []) as Array<{ action_id: string; kind: string; after_value: unknown }>) {
    if (e.kind === 'unassigned') {
      contactCleared.add(e.action_id)
    } else if (e.kind === 'due_date_changed') {
      const after = e.after_value as { date?: string | null } | null
      if (after && after.date == null) dueDateCleared.add(e.action_id)
    }
  }

  return (rows ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    status: r.status as ReconciliationCandidateAction['status'],
    supersededBy: r.superseded_by as string | null,
    title: r.title as string | null,
    body: r.body as string | null,
    assignedTo: r.assigned_to as string | null,
    assignedContactId: r.assigned_contact_id as string | null,
    assignedCompanyId: r.assigned_company_id as string | null,
    dueDate: r.due_date as string | null,
    dueDateStatus: r.due_date_status as ReconciliationCandidateAction['dueDateStatus'],
    reserveId: r.reserve_id as string | null,
    doneAt: r.done_at as string | null,
    completedComment: r.completed_comment as string | null,
    completedPhotoPath: r.completed_photo_path as string | null,
    contactExplicitlyCleared: contactCleared.has(r.id as string),
    dueDateExplicitlyCleared: dueDateCleared.has(r.id as string),
  }))
}

interface ReconcileGroupResult {
  outcome: ReconciliationOutcome
  actionsSuperseded: number
}

async function reconcileOneCanonicalBusinessObject(
  sb: AdminClient,
  canonicalBusinessObjectId: string,
): Promise<ReconcileGroupResult> {
  const { data: members } = await sb
    .from('canonical_business_object_member')
    .select('member_entity_id')
    .eq('canonical_business_object_id', canonicalBusinessObjectId)
    .eq('member_entity_type', 'site_action')
  const actionIds = [...new Set((members ?? []).map((m) => m.member_entity_id as string))]
  if (actionIds.length <= 1) return { outcome: { kind: 'none' }, actionsSuperseded: 0 }

  const actions = await loadCandidateActions(sb, actionIds)
  const outcome = planActionCboReconciliation(actions)

  if (outcome.kind !== 'merge') return { outcome, actionsSuperseded: 0 }

  const { data, error } = await sb.rpc('fn_apply_action_cbo_merge', {
    p_durable_id: outcome.durableId,
    p_loser_ids: outcome.loserIds,
    p_patch: outcome.patch,
    p_actor_id: null,
  })
  if (error) {
    logError(`fn_apply_action_cbo_merge a échoué cbo=${canonicalBusinessObjectId} durable=${outcome.durableId}`, error)
    throw error
  }
  return { outcome, actionsSuperseded: typeof data === 'number' ? data : 0 }
}

/**
 * Point d'entrée appelé depuis le pipeline de post-traitement d'import
 * historique, juste après attachHistoricalReportEntitiesToCanonicalBusinessObjects
 * (les Actions du rapport viennent d'obtenir leur rattachement CBO). Ne
 * réconcilie que les CBO effectivement touchés par CE rapport — les autres
 * groupes CBO du chantier sont laissés pour leur propre passage (idempotent,
 * rejouable sans effet si déjà stable).
 *
 * N'avale plus silencieusement les échecs RPC (P0-B.1, point 6) : une panne
 * `fn_apply_action_cbo_merge` est relancée vers l'appelant, qui décide de la
 * persistance d'erreur/retry (cf. historical-import-post-processing.ts).
 * `groupsBlockedDoneDurable` compte les groupes cas C (durable déjà 'done',
 * divergence documentaire potentielle) — aucune écriture, signal seul.
 */
export async function reconcileActionsByCanonicalBusinessObjectForReport(params: {
  siteReportId: string
}): Promise<{ groupsReconciled: number; actionsSuperseded: number; groupsBlockedDoneDurable: number }> {
  const { siteReportId } = params
  const sb = createAdminClient()

  const { data: reportActions } = await sb
    .from('site_actions')
    .select('id')
    .eq('report_id', siteReportId)
  const reportActionIds = (reportActions ?? []).map((r) => r.id as string)
  if (reportActionIds.length === 0) return { groupsReconciled: 0, actionsSuperseded: 0, groupsBlockedDoneDurable: 0 }

  const { data: members } = await sb
    .from('canonical_business_object_member')
    .select('canonical_business_object_id')
    .eq('member_entity_type', 'site_action')
    .in('member_entity_id', reportActionIds)
  const cboIds = [...new Set((members ?? []).map((m) => m.canonical_business_object_id as string))]
  if (cboIds.length === 0) return { groupsReconciled: 0, actionsSuperseded: 0, groupsBlockedDoneDurable: 0 }

  let groupsReconciled = 0
  let actionsSuperseded = 0
  let groupsBlockedDoneDurable = 0
  for (const cboId of cboIds) {
    const { outcome, actionsSuperseded: superseded } = await reconcileOneCanonicalBusinessObject(sb, cboId)
    if (outcome.kind === 'blocked_done_durable') {
      groupsBlockedDoneDurable += 1
    } else if (superseded > 0) {
      groupsReconciled += 1
      actionsSuperseded += superseded
    }
  }
  if (actionsSuperseded > 0 || groupsBlockedDoneDurable > 0) {
    log(
      `siteReportId=${siteReportId} groupes=${groupsReconciled} actions_superseded=${actionsSuperseded} ` +
        `groupes_bloques_done=${groupsBlockedDoneDurable}`,
    )
  }
  return { groupsReconciled, actionsSuperseded, groupsBlockedDoneDurable }
}
