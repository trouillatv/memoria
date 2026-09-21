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

/**
 * Enveloppe best-effort à invoquer depuis les points d'appel de
 * canonical-business-object-attach.ts, immédiatement après un rattachement CBO effectif
 * (attached_existing/created_new — jamais sur skipped, aucun membership n'a changé). Même
 * doctrine que produceSignalBestEffort : une panne ne doit jamais faire échouer la mutation
 * canonique qui l'a déclenchée.
 */
export async function reconcileTrackedPointMutationBestEffort(params: {
  siteId: string
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  canonicalBusinessObjectId: string
}): Promise<void> {
  try {
    await reconcileTrackedPointAfterCanonicalMutation(params)
  } catch (e) {
    logError(`réévaluation non bloquante entity=${params.entityId} type=${params.entityType}`, e)
  }
}
