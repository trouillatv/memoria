import 'server-only'

// P1-C2B.2 — branchement live du resolver CBO (canonical-business-object-resolve.ts)
// sur les 3 writers métier + le chemin d'import historique.
//
// P1-C2B H2-B.3 (Vincent, 2026-08-25) — chaque tentative de rattachement CBO de ce
// module est immédiatement suivie d'un appel à produceObjectStateOccurrenceSignal
// (cb67eedb, lib/db/object-state-occurrence-signal.ts, aucune seconde implémentation),
// via produceSignalBestEffort. Ordre strict : objet créé → sujet canonique résolu →
// CBO rattaché (ou tentative épuisée) → signal produit. Best-effort, jamais avant que
// le CBO soit connu (id réel ou null explicitement — jamais si la résolution du sujet
// canonique lui-même a échoué, auquel cas la production du signal est différée).
//
// Doctrine (Vincent, 2026-08-24) :
//   - Scope strict par canonical_subject_id — jamais de rapprochement entre deux
//     sujets canoniques différents (getCanonicalSubjectEntities filtre déjà par sujet).
//   - Comparaison uniquement intra-type (action↔action, réserve↔réserve, échéance↔échéance).
//   - SAME_OBJECT → rattache au CBO existant. RELATED_BUT_DISTINCT / UNCERTAIN → nouvel
//     objet, jamais de fusion automatique.
//   - Une panne (LLM, réseau, DB) ne bloque jamais la création métier de l'entité source :
//     toute fonction de ce module capte ses erreurs et ne relance jamais.
//   - Idempotent : contrainte UNIQUE(member_entity_type, member_entity_id) en base
//     (mig 302) — rejouer ne crée jamais un second membership.
//   - Ce module ne fait AUCUNE modification de statut métier (open/done/lifted…).

import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCanonicalSubjectReference } from '@/lib/db/canonical-subject-resolve'
import { makeWinnerResolver, type SubjectRow } from '@/lib/db/canonical-subject-project'
import {
  getCanonicalSubjectEntities,
  resolveCanonicalBusinessObjectGroups,
  type CanonicalBusinessObjectEntityType,
  type ResolvableEntity,
  type ResolverDecision,
} from '@/lib/db/canonical-business-object-resolve'
import { produceObjectStateOccurrenceSignal } from '@/lib/db/object-state-occurrence-signal'

type AdminClient = ReturnType<typeof createAdminClient>

export type AttachOutcome =
  | { kind: 'attached_existing'; canonicalBusinessObjectId: string; decision: ResolverDecision; confidence: number; reasoning: string }
  | { kind: 'created_new'; canonicalBusinessObjectId: string; source: 'llm' | 'deterministic'; decision?: ResolverDecision; confidence?: number; reasoning?: string }
  | { kind: 'skipped'; reason: string }

const TARGET_TABLE: Record<CanonicalBusinessObjectEntityType, string> = {
  site_action: 'site_actions',
  site_reserve: 'site_reserve',
  site_deadline: 'site_deadlines',
}

function log(msg: string) {
  console.log(`[cbo-attach] ${msg}`)
}
function logError(msg: string, err: unknown) {
  console.error(`[cbo-attach] ${msg}`, err)
}

/**
 * P1-C2B H2-B.3 — branchement live du producteur de signal d'occurrence
 * (cb67eedb, lib/db/object-state-occurrence-signal.ts), réutilisé tel quel.
 *
 * Appelée uniquement après une tentative de rattachement CBO (jamais avant) :
 * à ce stade le CBO est « connu » (un id, ou null si l'objet n'en a pas encore).
 * produceObjectStateOccurrenceSignal relit lui-même canonical_business_object_member,
 * donc null ici est valide et sera corrigé automatiquement par le trigger
 * trg_sync_occurrence_signal_cbo (mig 349) si un CBO est rattaché plus tard.
 *
 * Best-effort strict : une panne Gemini/DB ne doit jamais remonter à l'appelant.
 */
async function produceSignalBestEffort(entityType: CanonicalBusinessObjectEntityType, entityId: string): Promise<void> {
  try {
    await produceObjectStateOccurrenceSignal({ entityType, entityId })
  } catch (e) {
    logError(`production signal d'occurrence non bloquante entity=${entityId} type=${entityType}`, e)
  }
}

/**
 * Décide si `entityId` (déjà rattaché à `canonicalSubjectId`) appartient à un
 * canonical_business_object existant du même (sujet, type), ou en crée un nouveau.
 * Ne fait rien si `canonicalSubjectId` est null (non-bloquant — tracé en log).
 * Ne lève jamais.
 */
export async function attachToCanonicalBusinessObject(params: {
  siteId: string
  canonicalSubjectId: string | null
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  label: string
  date: string | null
}): Promise<AttachOutcome> {
  const { siteId, canonicalSubjectId, entityType, entityId, label, date } = params

  if (!canonicalSubjectId) {
    log(`skip entity=${entityId} type=${entityType} — pas de canonical_subject_id résolu`)
    return { kind: 'skipped', reason: 'no_canonical_subject' }
  }

  try {
    const sb = createAdminClient()

    const { data: existingMembership } = await sb
      .from('canonical_business_object_member')
      .select('canonical_business_object_id')
      .eq('member_entity_type', entityType)
      .eq('member_entity_id', entityId)
      .maybeSingle()
    if (existingMembership) {
      return { kind: 'skipped', reason: 'already_member' }
    }

    const siblingEntities = await getCanonicalSubjectEntities(canonicalSubjectId, entityType)
    const newEntity: ResolvableEntity = { entityId, label, date, stableKey: null }
    const candidatePool = siblingEntities.some((e) => e.entityId === entityId)
      ? siblingEntities
      : [...siblingEntities, newEntity]

    const otherIds = candidatePool.map((e) => e.entityId).filter((id) => id !== entityId)
    const { data: memberships } = otherIds.length
      ? await sb
          .from('canonical_business_object_member')
          .select('member_entity_id, canonical_business_object_id')
          .eq('member_entity_type', entityType)
          .in('member_entity_id', otherIds)
      : { data: [] as { member_entity_id: string; canonical_business_object_id: string }[] }
    const cboByEntityId = new Map((memberships ?? []).map((m) => [m.member_entity_id, m.canonical_business_object_id]))

    if (candidatePool.length < 2) {
      return createSoloCbo(sb, siteId, canonicalSubjectId, entityType, entityId, label)
    }

    const groups = await resolveCanonicalBusinessObjectGroups(candidatePool)
    const ownGroup = groups.find((g) => g.members.includes(entityId))

    if (!ownGroup || ownGroup.decision !== 'SAME_OBJECT') {
      return createSoloCbo(sb, siteId, canonicalSubjectId, entityType, entityId, label, ownGroup)
    }

    const existingCboIds = new Set(
      ownGroup.members
        .filter((id) => id !== entityId)
        .map((id) => cboByEntityId.get(id))
        .filter((id): id is string => Boolean(id)),
    )

    if (existingCboIds.size > 1) {
      // Ambiguïté réelle : le groupe SAME_OBJECT touche deux CBO existants distincts.
      // Jamais de fusion automatique de CBO — on isole l'entité en solo et on trace.
      log(`ambiguous group entity=${entityId} touches ${existingCboIds.size} distinct existing CBOs — solo fallback`)
      return createSoloCbo(sb, siteId, canonicalSubjectId, entityType, entityId, label, ownGroup)
    }

    if (existingCboIds.size === 1) {
      const existingCboId = [...existingCboIds][0]
      const { error } = await sb.from('canonical_business_object_member').insert({
        canonical_business_object_id: existingCboId,
        member_entity_type: entityType,
        member_entity_id: entityId,
        resolution_source: 'llm',
        llm_confidence: ownGroup.confidence,
        llm_reasoning: ownGroup.reasoning,
      })
      if (error) {
        if (error.code === '23505') return { kind: 'skipped', reason: 'already_member_race' }
        logError(`erreur insertion membre entity=${entityId}`, error)
        return { kind: 'skipped', reason: 'insert_error' }
      }
      log(`attached entity=${entityId} type=${entityType} subject=${canonicalSubjectId} → CBO existant ${existingCboId} (confidence=${ownGroup.confidence})`)
      return { kind: 'attached_existing', canonicalBusinessObjectId: existingCboId, decision: ownGroup.decision, confidence: ownGroup.confidence, reasoning: ownGroup.reasoning }
    }

    // Aucun CBO existant parmi les membres du groupe : nouvelle identité durable,
    // regroupant uniquement les membres pas encore couverts par un autre CBO.
    return createGroupCbo(sb, siteId, canonicalSubjectId, entityType, ownGroup, cboByEntityId)
  } catch (e) {
    logError(`panne non bloquante entity=${entityId} type=${entityType}`, e)
    return { kind: 'skipped', reason: 'exception' }
  }
}

/**
 * Résout le winner final de canonicalSubjectId (cf. makeWinnerResolver) juste avant
 * la création d'un CBO — jamais avant : le sujet a pu fusionner entre le début de
 * la résolution (getCanonicalSubjectEntities) et l'écriture. null si irrésolvable
 * (chaîne cyclique/rompue) : on préfère ne rien créer plutôt qu'écrire une cible
 * dont on ne sait pas prouver qu'elle est vivante (P1-C2B.3 Gate 2).
 */
async function resolveWinnerSubjectId(sb: AdminClient, canonicalSubjectId: string): Promise<string | null> {
  const resolveWinner = makeWinnerResolver(sb, new Map<string, SubjectRow>())
  const resolved = await resolveWinner(canonicalSubjectId)
  return resolved?.id ?? null
}

async function createSoloCbo(
  sb: AdminClient,
  siteId: string,
  canonicalSubjectId: string,
  entityType: CanonicalBusinessObjectEntityType,
  entityId: string,
  label: string,
  decidedGroup?: { decision: ResolverDecision; confidence: number; reasoning: string },
): Promise<AttachOutcome> {
  const winnerSubjectId = await resolveWinnerSubjectId(sb, canonicalSubjectId)
  if (!winnerSubjectId) {
    logError(`winner introuvable (chaîne de fusion cyclique/rompue) entity=${entityId} subject=${canonicalSubjectId}`, null)
    return { kind: 'skipped', reason: 'winner_unresolved' }
  }

  const { data: cbo, error } = await sb
    .from('canonical_business_object')
    .insert({ site_id: siteId, object_type: entityType, label, canonical_subject_id: winnerSubjectId })
    .select('id')
    .single()
  if (error || !cbo) {
    logError(`erreur création CBO solo entity=${entityId}`, error)
    return { kind: 'skipped', reason: 'insert_error' }
  }

  const { error: memberErr } = await sb.from('canonical_business_object_member').insert({
    canonical_business_object_id: cbo.id,
    member_entity_type: entityType,
    member_entity_id: entityId,
    resolution_source: decidedGroup ? 'llm' : 'deterministic',
    llm_confidence: decidedGroup?.confidence ?? null,
    llm_reasoning: decidedGroup?.reasoning ?? null,
  })
  if (memberErr) {
    if (memberErr.code === '23505') return { kind: 'skipped', reason: 'already_member_race' }
    logError(`erreur insertion membre solo entity=${entityId}`, memberErr)
    return { kind: 'skipped', reason: 'insert_error' }
  }

  log(`created solo CBO entity=${entityId} type=${entityType} subject=${canonicalSubjectId} → ${cbo.id} (decision=${decidedGroup?.decision ?? 'n/a'})`)
  return {
    kind: 'created_new',
    canonicalBusinessObjectId: cbo.id,
    source: decidedGroup ? 'llm' : 'deterministic',
    decision: decidedGroup?.decision,
    confidence: decidedGroup?.confidence,
    reasoning: decidedGroup?.reasoning,
  }
}

async function createGroupCbo(
  sb: AdminClient,
  siteId: string,
  canonicalSubjectId: string,
  entityType: CanonicalBusinessObjectEntityType,
  group: { label: string; members: string[]; decision: ResolverDecision; confidence: number; reasoning: string },
  cboByEntityId: Map<string, string>,
): Promise<AttachOutcome> {
  const uncoveredMembers = group.members.filter((id) => !cboByEntityId.has(id))

  const winnerSubjectId = await resolveWinnerSubjectId(sb, canonicalSubjectId)
  if (!winnerSubjectId) {
    logError(`winner introuvable (chaîne de fusion cyclique/rompue) entity(s)=${uncoveredMembers.join(',')} subject=${canonicalSubjectId}`, null)
    return { kind: 'skipped', reason: 'winner_unresolved' }
  }

  const { data: cbo, error } = await sb
    .from('canonical_business_object')
    .insert({ site_id: siteId, object_type: entityType, label: group.label, canonical_subject_id: winnerSubjectId })
    .select('id')
    .single()
  if (error || !cbo) {
    logError(`erreur création CBO groupe entity(s)=${uncoveredMembers.join(',')}`, error)
    return { kind: 'skipped', reason: 'insert_error' }
  }

  const rows = uncoveredMembers.map((id) => ({
    canonical_business_object_id: cbo.id,
    member_entity_type: entityType,
    member_entity_id: id,
    resolution_source: 'llm' as const,
    llm_confidence: group.confidence,
    llm_reasoning: group.reasoning,
  }))
  const { error: memberErr } = await sb.from('canonical_business_object_member').insert(rows)
  if (memberErr) {
    logError(`erreur insertion membres groupe (${rows.length})`, memberErr)
    return { kind: 'skipped', reason: 'insert_error' }
  }

  log(`created group CBO ${cbo.id} type=${entityType} subject=${canonicalSubjectId} — ${rows.length} membre(s) (confidence=${group.confidence})`)
  return { kind: 'created_new', canonicalBusinessObjectId: cbo.id, source: 'llm', decision: group.decision, confidence: group.confidence, reasoning: group.reasoning }
}

/**
 * Orchestrateur best-effort appelé depuis les writers métier (createSiteAction,
 * createSiteReserve, createSiteDeadline, et le writer de confirmation d'action
 * confirmSiteAction qui partage ce même chemin) juste après l'insertion : résout
 * le sujet canonique depuis le libellé (même resolver que l'existant, mig 346),
 * pose la colonne directe si trouvée, tente le rattachement CBO, puis (H2-B.3)
 * produit le signal d'occurrence — dans cet ordre strict, seulement si le sujet
 * canonique a pu être résolu (sinon la production du signal est différée).
 *
 * Fire-and-forget par construction (jamais attendu par l'appelant) — capte
 * toute erreur, ne relance jamais. À invoquer via `void resolveSubjectAndAttachCanonicalBusinessObject(...)`.
 */
export async function resolveSubjectAndAttachCanonicalBusinessObject(params: {
  siteId: string
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  label: string
  date: string | null
}): Promise<void> {
  const { siteId, entityType, entityId, label, date } = params
  try {
    const res = await resolveCanonicalSubjectReference(siteId, label)
    if (res.kind !== 'resolved') return

    const sb = createAdminClient()
    await sb.from(TARGET_TABLE[entityType]).update({ canonical_subject_id: res.candidate.id }).eq('id', entityId)

    await attachToCanonicalBusinessObject({ siteId, canonicalSubjectId: res.candidate.id, entityType, entityId, label, date })
    await produceSignalBestEffort(entityType, entityId)
  } catch (e) {
    logError(`résolution sujet+CBO non bloquante entity=${entityId} type=${entityType}`, e)
  }
}

/**
 * Chemin d'import historique (materialize_historical_visit) : le RPC SQL a déjà
 * créé l'entité et son lien document_proposal_materialization → proposal →
 * subject_thread_id. On lit ce chemin déjà établi (jamais de re-résolution par
 * libellé — le fil thématique fait foi), pose la colonne directe si elle est
 * encore vide (jamais d'écrasement), puis tente le rattachement CBO.
 *
 * Pour site_action/site_deadline, `projectCanonicalSubjectOnObjects()`
 * (lib/db/canonical-subject-project.ts, P0-J.3) est le mécanisme AUTORITATIF —
 * il résout aussi les chaînes de fusion et la piste de promotion terrain, que
 * cette fonction ignore volontairement pour ne pas construire un second moteur
 * de résolution de sujet. Cette fonction reste le seul chemin pour site_reserve,
 * non couvert par cette projection (ProjectableObjectType ne liste pas 'site_reserve').
 */
export async function attachHistoricalEntityToCanonicalBusinessObject(params: {
  siteId: string
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  label: string
  date: string | null
}): Promise<void> {
  const { siteId, entityType, entityId, label, date } = params
  try {
    const sb = createAdminClient()

    const { data: mat } = await sb
      .from('document_proposal_materialization')
      .select('proposal_id')
      .eq('target_entity_type', entityType)
      .eq('target_entity_id', entityId)
      .maybeSingle()
    if (!mat) return

    const { data: proposal } = await sb
      .from('document_extraction_proposal')
      .select('subject_thread_id')
      .eq('id', mat.proposal_id)
      .maybeSingle()
    if (!proposal?.subject_thread_id) return

    const { data: identity } = await sb
      .from('subject_thread_identity')
      .select('canonical_subject_id')
      .eq('subject_thread_id', proposal.subject_thread_id)
      .maybeSingle()
    if (!identity?.canonical_subject_id) return

    // Ne jamais écraser une FK déjà posée (ex. écriture concurrente).
    await sb
      .from(TARGET_TABLE[entityType])
      .update({ canonical_subject_id: identity.canonical_subject_id })
      .eq('id', entityId)
      .is('canonical_subject_id', null)

    await attachToCanonicalBusinessObject({
      siteId,
      canonicalSubjectId: identity.canonical_subject_id,
      entityType,
      entityId,
      label,
      date,
    })
    await produceSignalBestEffort(entityType, entityId)
  } catch (e) {
    logError(`rattachement historique non bloquant entity=${entityId} type=${entityType}`, e)
  }
}

/**
 * Orchestrateur déclenché après l'import d'un PV historique (createHistoricalVisitAction,
 * via `after()` — non bloquant pour la réponse HTTP), une fois que
 * `projectCanonicalSubjectSafely()` a déjà écrit `canonical_subject_id` sur les
 * actions/échéances du rapport. Relit l'état final en base (plutôt que de faire
 * transiter le rapport de projection à travers la fermeture `after()`) et tente
 * le rattachement CBO pour chaque entité déjà rattachée à un sujet canonique.
 *
 * site_reserve n'étant couvert par aucune projection amont, chaque réserve du
 * rapport est résolue ici via `attachHistoricalEntityToCanonicalBusinessObject`
 * (chaîne document_proposal_materialization → subject_thread_identity).
 *
 * H2-B.3 : chaque tentative de rattachement CBO (directe ici, ou via
 * `attachHistoricalEntityToCanonicalBusinessObject` pour les réserves) est
 * immédiatement suivie de la production du signal d'occurrence.
 *
 * Ne lève jamais : un rattachement CBO manqué ne doit jamais faire échouer
 * l'import d'un PV historique, déjà terminé et répondu au client à cet instant.
 */
export async function attachHistoricalReportEntitiesToCanonicalBusinessObjects(params: {
  siteId: string
  siteReportId: string
}): Promise<void> {
  const { siteId, siteReportId } = params
  try {
    const sb = createAdminClient()

    const [{ data: actions }, { data: deadlines }, { data: reserves }] = await Promise.all([
      sb.from('site_actions').select('id, title, due_date, canonical_subject_id').eq('report_id', siteReportId),
      sb.from('site_deadlines').select('id, title, due_date, canonical_subject_id').eq('report_id', siteReportId),
      sb.from('site_reserve').select('id, label, issued_on, canonical_subject_id').eq('report_id', siteReportId),
    ])

    for (const row of (actions ?? []) as Array<{ id: string; title: string; due_date: string | null; canonical_subject_id: string | null }>) {
      if (!row.canonical_subject_id) continue
      await attachToCanonicalBusinessObject({
        siteId,
        canonicalSubjectId: row.canonical_subject_id,
        entityType: 'site_action',
        entityId: row.id,
        label: row.title,
        date: row.due_date,
      })
      await produceSignalBestEffort('site_action', row.id)
    }

    for (const row of (deadlines ?? []) as Array<{ id: string; title: string; due_date: string | null; canonical_subject_id: string | null }>) {
      if (!row.canonical_subject_id) continue
      await attachToCanonicalBusinessObject({
        siteId,
        canonicalSubjectId: row.canonical_subject_id,
        entityType: 'site_deadline',
        entityId: row.id,
        label: row.title,
        date: row.due_date,
      })
      await produceSignalBestEffort('site_deadline', row.id)
    }

    for (const row of (reserves ?? []) as Array<{ id: string; label: string; issued_on: string | null; canonical_subject_id: string | null }>) {
      if (row.canonical_subject_id) {
        await attachToCanonicalBusinessObject({
          siteId,
          canonicalSubjectId: row.canonical_subject_id,
          entityType: 'site_reserve',
          entityId: row.id,
          label: row.label,
          date: row.issued_on,
        })
        await produceSignalBestEffort('site_reserve', row.id)
      } else {
        await attachHistoricalEntityToCanonicalBusinessObject({
          siteId,
          entityType: 'site_reserve',
          entityId: row.id,
          label: row.label,
          date: row.issued_on,
        })
      }
    }
  } catch (e) {
    logError(`rattachement historique (rapport) non bloquant siteReportId=${siteReportId}`, e)
  }
}
