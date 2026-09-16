import 'server-only'

// P0-B / P0-B.1 / P0-B.2 (stabilisation post-2-PV, arbitrage Vincent 2026-09-17) —
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
// P0-B.2 (revue Vincent 2026-09-17, FIX_REQUIRED avant migration 413) corrige
// un défaut P0 de P0-B.1 : la chronologie utilisée était l'ordre d'IMPORT
// (createdAt), pas la chronologie MÉTIER. Un historique importé rétroactivement
// peut arriver dans n'importe quel ordre (PV du 13/12 importé avant le PV du
// 10/12) — la même doctrine déjà validée ailleurs dans MemorIA (moteur temporel
// des Points, `runEffectiveDate()`) s'applique ici : la date métier détermine
// l'état, jamais l'ordre d'import ni une hiérarchie abstraite de statuts.
//
// Doctrine (mirror exact de la doctrine SQL, migration 413) :
//   · Date métier (`businessDate`) = repli à 3 niveaux (arbitrage Vincent
//     2026-09-17, audit P0-B/P0-C started_at=NULL) :
//       1. site_reports.started_at — fiable quand présent (natif temps réel,
//          historique migré après la 261).
//       2. documents.effective_date (via site_reports.source_document_id) —
//          date documentaire du PV source. Nécessaire car la migration 298
//          (CREATE OR REPLACE de materialize_historical_visit à partir d'une
//          base antérieure à 261) a silencieusement réintroduit l'absence
//          d'insertion de started_at pour tout l'historique importé depuis —
//          confirmé encore actif en base au moment de l'audit, sans qu'aucune
//          migration ultérieure (336/337/338/367/368/374/375/413) ne le corrige.
//       3. `created_at` (heure d'insertion en base) — dernier repli, seulement
//          si l'Action n'a ni rapport source ni document source avec date.
//     Ce repli à 3 niveaux ne modifie aucune donnée existante : il ne change
//     que le tri utilisé par la réconciliation.
//   · Identité durable = la ligne de date métier la plus ANCIENNE parmi les
//     Actions encore actives du groupe (status IN 'open'|'planned'|'done' ET
//     supersededBy IS NULL) — tie-break par id. Choix arbitraire mais stable
//     (indépendant de l'ordre d'import), jamais changé une fois posé.
//   · Le statut final adopté est celui du membre actif de date métier la plus
//     RÉCENTE (« latest ») — jamais une hiérarchie planned<open<done comparée
//     sans tenir compte des dates, qui ferait gagner un `done` ancien sur un
//     `open` métier plus récent selon l'ordre d'import (cas A/B/C/D corrigés).
//   · Exception P0 : si un membre `done` existe à une date métier ANTÉRIEURE à
//     la date métier la plus récente, et que celle-ci n'est pas elle-même
//     `done` — c'est une réouverture métier après clôture. AUCUNE fusion
//     automatique : jamais de réouverture silencieuse d'un `done` (cas B),
//     divergence à arbitrer humainement (cf. cbo-lifecycle-reducer.ts, non
//     branché ici).
//   · Exception P0 : si le groupe contient PLUSIEURS occurrences `done` (à des
//     dates métier distinctes), ce n'est jamais supposé être un doublon fusible
//     sans preuve — peut représenter deux exécutions réelles distinctes de la
//     même obligation récurrente (cas E). Signalé, jamais fusionné.
//   · Champs simples (titre, corps, entreprise assignée, réserve liée) : ne
//     sont comblés que si vides côté durable — jamais écrasés.
//   · Contact assigné, entreprise assignée et échéance sont protégés plus fort :
//     si un humain les a explicitement retirés (événement `unassigned` /
//     `due_date_changed` vers null au journal), un doublon ne peut jamais les
//     re-remplir silencieusement (protection entreprise ajoutée en P0-B.2,
//     cf. migration 414 — fn_update_action ne journalisait pas encore le
//     retrait d'entreprise).
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
// durable déjà 'done' sans membre actif plus récent ne produit plus de patch).

import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface ReconciliationCandidateAction {
  id: string
  /** Heure d'insertion en base — jamais utilisée pour la logique (P0-B.2). Conservée en repli de businessDate. */
  createdAt: string
  /**
   * Date métier résolue (P0-B.2, repli 3 niveaux 2026-09-17) : started_at du
   * rapport source, sinon effective_date du document source, sinon createdAt.
   * Seul champ utilisé pour trier/identifier — jamais createdAt directement.
   */
  businessDate: string
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
  /** Un événement `unassigned` (clé contact_id) existe déjà pour cette action (retrait humain explicite). */
  contactExplicitlyCleared: boolean
  /** Un événement `unassigned` (clé company_id) existe déjà pour cette action (retrait humain explicite, P0-B.2 / mig 414). */
  companyExplicitlyCleared: boolean
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
  | {
      kind: 'blocked_done_durable'
      /** P0-B.2 : pourquoi aucune fusion n'a été appliquée, pour un signal humain précis. */
      reason: 'reopened_after_done' | 'multiple_done_occurrences'
      durableId: string
      pendingActiveIds: string[]
    }
  | { kind: 'merge'; durableId: string; loserIds: string[]; patch: ActionCboMergePatch }

type ActiveStatus = 'planned' | 'open' | 'done'
type ActiveCandidateAction = ReconciliationCandidateAction & { status: ActiveStatus }

function isActiveCandidate(a: ReconciliationCandidateAction): a is ActiveCandidateAction {
  return a.status !== 'cancelled' && a.supersededBy === null
}

/**
 * Logique pure, sans I/O : parmi les Actions d'un même CBO, détermine l'identité
 * durable et le meilleur état opérationnel courant (doctrine ci-dessus). Miroir
 * exact des règles appliquées par fn_apply_action_cbo_merge (migration 413) —
 * toute divergence entre les deux doit être traitée comme un bug.
 *
 * P0-B.2 : tri et décision reposent exclusivement sur `businessDate` — jamais
 * sur l'ordre du tableau `actions` ni sur `createdAt`. Permuter l'ordre d'entrée
 * ne doit jamais changer le résultat (propriété vérifiée par les tests A→E).
 */
export function planActionCboReconciliation(
  actions: ReconciliationCandidateAction[],
): ReconciliationOutcome {
  const active = actions.filter(isActiveCandidate)
  if (active.length <= 1) return { kind: 'none' }

  const sorted = [...active].sort(
    (a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id),
  )
  const [durable, ...others] = sorted
  const latest = sorted[sorted.length - 1]
  const pendingIds = others.map((a) => a.id)

  const doneCount = sorted.filter((a) => a.status === 'done').length
  // Un `done` existe à une date métier antérieure à la plus récente, qui n'est
  // elle-même pas `done` : réouverture métier après clôture (cas B). Jamais
  // silencieux — cf. doctrine ci-dessus.
  const reopenedAfterDone = latest.status !== 'done' && sorted.slice(0, -1).some((a) => a.status === 'done')
  if (reopenedAfterDone) {
    return { kind: 'blocked_done_durable', reason: 'reopened_after_done', durableId: durable.id, pendingActiveIds: pendingIds }
  }
  // Plusieurs occurrences `done` à des dates métier distinctes : jamais supposé
  // doublon fusible sans preuve — peut être deux exécutions réelles (cas E).
  if (doneCount >= 2) {
    return { kind: 'blocked_done_durable', reason: 'multiple_done_occurrences', durableId: durable.id, pendingActiveIds: pendingIds }
  }

  const patch: ActionCboMergePatch = {}

  // Le statut final adopté est celui du membre de date métier la plus récente
  // (jamais une hiérarchie planned<open<done indépendante des dates).
  if (latest.status !== durable.status) {
    patch.status = latest.status
    if (latest.status === 'done') {
      if (latest.doneAt) patch.doneAt = latest.doneAt
      if (latest.completedComment) patch.completedComment = latest.completedComment
      if (latest.completedPhotoPath) patch.completedPhotoPath = latest.completedPhotoPath
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
  if (!durable.reserveId) {
    const source = others.find((o) => o.reserveId)
    if (source?.reserveId) patch.reserveId = source.reserveId
  }

  // Entreprise assignée : protection renforcée (P0-B.2 / mig 414) — un retrait
  // humain explicite bloque tout remplissage, comme contact et échéance.
  if (!durable.assignedCompanyId && !durable.companyExplicitlyCleared) {
    const source = others.find((o) => o.assignedCompanyId)
    if (source?.assignedCompanyId) patch.assignedCompanyId = source.assignedCompanyId
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

  return { kind: 'merge', durableId: durable.id, loserIds: pendingIds, patch }
}

function log(msg: string) {
  console.log(`[action-cbo-reconciliation] ${msg}`)
}
function logError(msg: string, err: unknown) {
  console.error(`[action-cbo-reconciliation] ${msg}`, err)
}

/**
 * Vrai si l'erreur PostgREST signale que fn_apply_action_cbo_merge n'existe pas
 * encore côté base (migration 413 pas encore appliquée). Le code est déployé sur
 * `main` avant le GO d'application de la migration (revue P0-B.1/P0-B.2,
 * Vincent 2026-09-17) — tant que la fonction est absente, cette étape doit se
 * comporter comme un no-op silencieux (comportement pré-P0-B.1), jamais comme un
 * échec qui bloque le pipeline d'import. Une fois 413 appliquée, toute autre
 * erreur RPC continue de propager normalement (durcissement point 6 intact).
 */
function isMissingReconcileRpcError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  const message = (err as { message?: string } | null)?.message ?? ''
  return code === 'PGRST202' || message.includes('fn_apply_action_cbo_merge')
}

async function loadCandidateActions(
  sb: AdminClient,
  actionIds: string[],
): Promise<ReconciliationCandidateAction[]> {
  const { data: rows } = await sb
    .from('site_actions')
    .select(
      'id, report_id, created_at, status, superseded_by, title, body, assigned_to, assigned_contact_id, assigned_company_id, due_date, due_date_status, reserve_id, done_at, completed_comment, completed_photo_path',
    )
    .in('id', actionIds)

  // P0-B.2 + repli 3 niveaux (2026-09-17) : date métier = started_at du
  // rapport source, sinon effective_date du document source (jamais
  // created_at en priorité, qui reflète l'ordre d'import et non la
  // chronologie métier).
  const reportIds = [...new Set((rows ?? []).map((r) => r.report_id as string | null).filter((id): id is string => id !== null))]
  const reportBusinessDate = new Map<string, string>()
  if (reportIds.length > 0) {
    const { data: reportRows } = await sb
      .from('site_reports')
      .select('id, started_at, source_document_id')
      .in('id', reportIds)
    const documentIds = [
      ...new Set((reportRows ?? []).map((r) => r.source_document_id as string | null).filter((id): id is string => id !== null)),
    ]
    const documentEffectiveDate = new Map<string, string>()
    if (documentIds.length > 0) {
      const { data: documentRows } = await sb.from('documents').select('id, effective_date').in('id', documentIds)
      for (const d of documentRows ?? []) {
        if (d.effective_date) documentEffectiveDate.set(d.id as string, d.effective_date as string)
      }
    }
    for (const r of reportRows ?? []) {
      const startedAt = r.started_at as string | null
      const documentId = r.source_document_id as string | null
      const businessDate = startedAt ?? (documentId ? documentEffectiveDate.get(documentId) : undefined)
      if (businessDate) reportBusinessDate.set(r.id as string, businessDate)
    }
  }

  const { data: eventRows } = await sb
    .from('site_action_events')
    .select('action_id, kind, before_value, after_value')
    .in('action_id', actionIds)
    .in('kind', ['unassigned', 'due_date_changed'])

  const contactCleared = new Set<string>()
  const companyCleared = new Set<string>()
  const dueDateCleared = new Set<string>()
  for (const e of (eventRows ?? []) as Array<{
    action_id: string
    kind: string
    before_value: unknown
    after_value: unknown
  }>) {
    if (e.kind === 'unassigned') {
      // Le payload d'un retrait est stocké dans before_value (mig 245/414) —
      // jamais after_value. La clé jsonb distingue contact_id de company_id.
      const before = e.before_value as { contact_id?: string; company_id?: string } | null
      if (before && 'contact_id' in before) contactCleared.add(e.action_id)
      if (before && 'company_id' in before) companyCleared.add(e.action_id)
    } else if (e.kind === 'due_date_changed') {
      const after = e.after_value as { date?: string | null } | null
      if (after && after.date == null) dueDateCleared.add(e.action_id)
    }
  }

  return (rows ?? []).map((r) => {
    const id = r.id as string
    const createdAt = r.created_at as string
    const reportId = r.report_id as string | null
    const businessDate = (reportId ? reportBusinessDate.get(reportId) : undefined) ?? createdAt
    return {
      id,
      createdAt,
      businessDate,
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
      contactExplicitlyCleared: contactCleared.has(id),
      companyExplicitlyCleared: companyCleared.has(id),
      dueDateExplicitlyCleared: dueDateCleared.has(id),
    }
  })
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
    if (isMissingReconcileRpcError(error)) {
      log(
        `fn_apply_action_cbo_merge absente en base (migration 413 pas encore appliquée) — ` +
          `cbo=${canonicalBusinessObjectId} ignoré sans erreur en attendant le GO migration.`,
      )
      return { outcome: { kind: 'none' }, actionsSuperseded: 0 }
    }
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
