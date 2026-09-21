import 'server-only'

// P0-A (mandat Vincent, root cause "mutation canonique tardive non signalée") — quand une
// mutation canonique change les CBO/membres d'un sujet (attachToCanonicalBusinessObject,
// lib/db/canonical-business-object-attach.ts), le(s) thread(s) réellement impacté(s) doivent
// être remontés dans le périmètre de réconciliation du Live Writer (critère #2). On réutilise
// TEL QUEL le moteur existant (reconcileFoundingUnits, extrait de
// tracked-point-live-writer-historical-adapter.ts) : aucune nouvelle logique de décision
// (critère #1), et reconcileTrackedPointUnit garantit déjà l'idempotence/replay-safety
// (critères #3/#4) en recalculant toujours le plan+fingerprint live.
//
// Flux imposé (mandat Vincent) : mutation/fusion CBO → identification des threads réellement
// impactés → réutilisation du moteur Live Writer existant → verdict AUTO_CREATED/AUTO_LINKED/
// NEEDS_HUMAN/IGNORED_NOT_TRACKABLE/rattachement existant. JAMAIS
// `CBO.tracked_point_id IS NULL → création forcée d'un Point`.
//
// Résolution du thread impacté : même chaîne que attachHistoricalEntityToCanonicalBusinessObject
// (document_proposal_materialization → proposal.subject_thread_id) — jamais de re-résolution par
// libellé, jamais de fabrication d'un thread. Une entité créée manuellement dans l'UI (pas de
// ligne de matérialisation, ex. resolveSubjectAndAttachCanonicalBusinessObject) n'a pas de
// subject_thread_id : la réévaluation est alors un no-op explicite (skipped_no_thread), jamais
// une erreur — cette entité n'a jamais été suivie via un thread PV.

import { createAdminClient } from '@/lib/supabase/admin'
import type { CanonicalBusinessObjectEntityType } from '@/lib/db/canonical-business-object-resolve'
import {
  loadThreadsFoundingInput,
  reconcileFoundingUnits,
  type HistoricalLiveWriterRunResult,
} from '@/lib/db/tracked-point-live-writer-historical-adapter'

type AdminClient = ReturnType<typeof createAdminClient>

export type ReconcileAfterMutationResult =
  | { kind: 'skipped_no_thread' }
  | ({ kind: 'reconciled'; threadId: string } & HistoricalLiveWriterRunResult)

function log(msg: string) {
  console.log(`[tracked-point-live-writer-mutation-adapter] ${msg}`)
}
function logError(msg: string, err: unknown) {
  console.error(`[tracked-point-live-writer-mutation-adapter] ${msg}`, err)
}

async function resolveMutatedEntityThreadId(
  db: AdminClient,
  entityType: CanonicalBusinessObjectEntityType,
  entityId: string,
): Promise<string | null> {
  const { data: mat } = await db
    .from('document_proposal_materialization')
    .select('proposal_id')
    .eq('target_entity_type', entityType)
    .eq('target_entity_id', entityId)
    .maybeSingle()
  if (!mat) return null

  const { data: proposal } = await db
    .from('document_extraction_proposal')
    .select('subject_thread_id')
    .eq('id', mat.proposal_id)
    .maybeSingle()
  return proposal?.subject_thread_id ?? null
}

/**
 * Cœur du lot P0-A : réévalue le(s) thread(s) réellement impacté(s) par une mutation canonique
 * (CBO créé/rattaché sur `entityId`) via le moteur Live Writer existant. Ne lève jamais côté
 * appelant réel (cf. reconcileTrackedPointMutationBestEffort) mais laisse remonter ses erreurs
 * ici — utilisé directement par le témoin SSI pour des assertions précises sur le verdict.
 */
export async function reconcileTrackedPointAfterCanonicalMutation(params: {
  siteId: string
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  canonicalBusinessObjectId: string
}): Promise<ReconcileAfterMutationResult> {
  const { siteId, entityType, entityId, canonicalBusinessObjectId } = params
  const db = createAdminClient()

  const threadId = await resolveMutatedEntityThreadId(db, entityType, entityId)
  if (!threadId) {
    log(`skip entity=${entityId} type=${entityType} — pas de subject_thread_id (objet non issu d'un PV)`)
    return { kind: 'skipped_no_thread' }
  }

  const loaded = await loadThreadsFoundingInput(db, siteId, [threadId])
  if (!loaded) return { kind: 'skipped_no_thread' }

  const result = await reconcileFoundingUnits(db, siteId, loaded, 'canonical_mutation', canonicalBusinessObjectId)
  log(`reconciled thread=${threadId} entity=${entityId} type=${entityType} cbo=${canonicalBusinessObjectId} — ${JSON.stringify(result.verdictCounts)}`)
  return { kind: 'reconciled', threadId, ...result }
}

// P0-A (suite REVIEW Vincent 2026-09-21) — "best-effort" ne doit jamais faire échouer la
// mutation canonique qui l'a déclenchée, mais un échec (refus RPC ponctuel ou exception) ne
// doit pas non plus disparaître sans trace : sans ça on recrée exactement la famille de
// défaut que P0-A corrige (thread jamais revisité). Une ligne par (entity_type, entity_id,
// canonical_business_object_id) — la DERNIÈRE tentative, jamais un historique complet.
async function upsertReconcileFailure(params: {
  siteId: string
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  canonicalBusinessObjectId: string
  error: string
}): Promise<void> {
  const db = createAdminClient()
  const { data: existing } = await db
    .from('tracked_point_reconcile_failure')
    .select('id, attempt_count')
    .eq('entity_type', params.entityType)
    .eq('entity_id', params.entityId)
    .eq('canonical_business_object_id', params.canonicalBusinessObjectId)
    .maybeSingle()

  const nowIso = new Date().toISOString()
  const { error } = await db.from('tracked_point_reconcile_failure').upsert(
    {
      site_id: params.siteId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      canonical_business_object_id: params.canonicalBusinessObjectId,
      error: params.error,
      attempt_count: (existing?.attempt_count ?? 0) + 1,
      last_attempt_at: nowIso,
      resolved_at: null,
    },
    { onConflict: 'entity_type,entity_id,canonical_business_object_id' },
  )
  if (error) logError(`persistance échec reconcile impossible entity=${params.entityId}`, error)
}

async function resolveReconcileFailureIfAny(params: {
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  canonicalBusinessObjectId: string
}): Promise<void> {
  const db = createAdminClient()
  await db
    .from('tracked_point_reconcile_failure')
    .update({ resolved_at: new Date().toISOString() })
    .eq('entity_type', params.entityType)
    .eq('entity_id', params.entityId)
    .eq('canonical_business_object_id', params.canonicalBusinessObjectId)
    .is('resolved_at', null)
}

/**
 * Enveloppe best-effort à invoquer depuis les points d'appel de
 * canonical-business-object-attach.ts, immédiatement après un rattachement CBO effectif
 * (attached_existing/created_new — jamais sur skipped, aucun membership n'a changé). Même
 * doctrine que produceSignalBestEffort : une panne ne doit jamais faire échouer la mutation
 * canonique qui l'a déclenchée. Contrairement à produceSignalBestEffort, l'échec est ici
 * persisté (tracked_point_reconcile_failure) pour être rejoué par
 * /api/cron/sweep-stuck-tracked-point-reconciliation — cf. réponse à la review du 2026-09-21.
 */
export async function reconcileTrackedPointMutationBestEffort(params: {
  siteId: string
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  canonicalBusinessObjectId: string
}): Promise<void> {
  try {
    const result = await reconcileTrackedPointAfterCanonicalMutation(params)
    if (result.kind === 'reconciled' && result.refusals > 0) {
      await upsertReconcileFailure({ ...params, error: `${result.refusals} refus RPC sur ${result.unitsProcessed} unité(s)` })
    } else if (result.kind === 'reconciled') {
      await resolveReconcileFailureIfAny(params)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError(`réévaluation non bloquante entity=${params.entityId} type=${params.entityType}`, e)
    await upsertReconcileFailure({ ...params, error: message })
  }
}

/**
 * Rejeu périodique (/api/cron/sweep-stuck-tracked-point-reconciliation) des mutations dont la
 * réévaluation Live Writer a échoué au moins une fois. Idempotent (reconcileTrackedPointUnit
 * recalcule toujours le plan+fingerprint live, cf. critère #3/#4 P0-A) : rejouer une mutation
 * déjà résolue entre-temps par un autre chemin est un NOOP, jamais un doublon.
 */
export async function replayPendingTrackedPointReconcileFailures(
  limit: number,
  olderThanMs: number,
): Promise<{ found: number; resolved: number; stillFailing: number }> {
  const db = createAdminClient()
  const threshold = new Date(Date.now() - olderThanMs).toISOString()
  const { data, error } = await db
    .from('tracked_point_reconcile_failure')
    .select('site_id, entity_type, entity_id, canonical_business_object_id')
    .is('resolved_at', null)
    .lte('last_attempt_at', threshold)
    .order('last_attempt_at', { ascending: true })
    .limit(limit)
  if (error) throw error

  const rows = (data ?? []) as Array<{
    site_id: string
    entity_type: CanonicalBusinessObjectEntityType
    entity_id: string
    canonical_business_object_id: string
  }>

  let resolved = 0
  let stillFailing = 0
  for (const row of rows) {
    const params = {
      siteId: row.site_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      canonicalBusinessObjectId: row.canonical_business_object_id,
    }
    try {
      const result = await reconcileTrackedPointAfterCanonicalMutation(params)
      if (result.kind === 'skipped_no_thread' || (result.kind === 'reconciled' && result.refusals === 0)) {
        // skipped_no_thread : plus rien à rejouer (aucune erreur, l'entité n'est simplement pas
        // issue d'un PV) — même traitement que resolved, jamais une boucle de rejeu infinie.
        await resolveReconcileFailureIfAny(params)
        resolved++
      } else {
        await upsertReconcileFailure({ ...params, error: `${result.refusals} refus RPC sur ${result.unitsProcessed} unité(s)` })
        stillFailing++
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logError(`rejeu échec reconcile entity=${row.entity_id}`, e)
      await upsertReconcileFailure({ ...params, error: message })
      stillFailing++
    }
  }

  return { found: rows.length, resolved, stillFailing }
}
