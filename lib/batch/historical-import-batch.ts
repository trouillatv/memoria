// BATCH-0 — orchestrateur chronologique de l'import historique, appelable sans UI.
//
// Ne réimplémente aucune mutation DB : chaque étape appelle la même primitive
// que celle utilisée par l'interface (extractHistoricalPv, acceptAllPendingForRun,
// materializeHistoricalRun, runHistoricalImportPostProcessing). Seule différence
// avec le chemin web : ici on ATTEND directement le post-traitement mémoire
// (pas de after() différé), pour que le document suivant voie la mémoire déjà
// construite par le précédent.
//
// La garde non-visite reste obligatoire et n'est jamais contournée : un document
// dont le texte signale l'absence de visite terrain est mis en quarantaine, pas
// matérialisé automatiquement.
//
// Aucun import corpus réel n'est déclenché par ce fichier — c'est un orchestrateur
// prêt à être appelé, pas une exécution.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  createExtractionRun,
  getExtractionRun,
  getLatestExtractionRunForDocument,
  acceptAllPendingForRun,
} from '@/lib/db/document-extractions'
import { extractHistoricalPv } from '@/lib/documents/extract-historical-pv'
import { materializeHistoricalRun } from '@/lib/documents/materialize-historical-run'
import { getExistingMaterializedVisit } from '@/lib/db/historical-visit-materialization'
import {
  runHistoricalImportPostProcessing,
  type HistoricalImportPostProcessingOutcome,
} from '@/lib/subjects/historical-import-post-processing'

export type BatchQuarantineReason =
  | 'DOCUMENT_NOT_FOUND'
  | 'EXTRACTION_ALREADY_RUNNING'
  | 'EXTRACTION_FAILED'
  | 'NO_SITE'
  | 'MISSING_DATE'
  | 'NON_VISIT_SIGNAL'
  | 'MATERIALIZATION_FAILED'
  | 'POST_PROCESSING_STUCK'
  | 'UNKNOWN_ERROR'

export interface HistoricalBatchDocumentInput {
  documentId: string
  siteId: string
  visitTitle?: string | null
}

export interface HistoricalBatchDocumentResult {
  documentId: string
  runId?: string
  siteReportId?: string
  status: 'materialized' | 'already_materialized' | 'quarantined'
  quarantineReason?: BatchQuarantineReason
  detail?: string
  postProcessingOutcome?: HistoricalImportPostProcessingOutcome
}

export interface HistoricalBatchOptions {
  /** created_by / reviewed_by tracé sur les objets créés — jamais null si évitable. */
  userId: string
  /** Nombre de tentatives supplémentaires après un run d'extraction en échec. Défaut 1. */
  extractionRetries?: number
  /** Nombre de relances sur concurrent/lock_lost avant quarantaine. Défaut 5. */
  postProcessingMaxRetries?: number
  /** Backoff initial (ms) entre deux relances de post-traitement, doublé à chaque tentative. Défaut 2000. */
  postProcessingBackoffMs?: number
}

export const READY_STATUSES = new Set(['ready_for_review', 'partially_materialized', 'materialized'])

/**
 * Traite une liste de documents DANS L'ORDRE fourni par l'appelant (chronologique).
 * Chaque document est entièrement terminé — post-traitement mémoire inclus — avant
 * que le suivant ne démarre.
 */
export async function runHistoricalImportBatch(
  documents: HistoricalBatchDocumentInput[],
  options: HistoricalBatchOptions,
): Promise<HistoricalBatchDocumentResult[]> {
  const results: HistoricalBatchDocumentResult[] = []
  for (const doc of documents) {
    results.push(await processHistoricalBatchDocument(doc, options))
  }
  return results
}

/**
 * Traite un seul document. Exportée séparément pour permettre un rejeu ciblé
 * (reprise après quarantaine sur un seul document) sans relancer tout le corpus.
 */
export async function processHistoricalBatchDocument(
  doc: HistoricalBatchDocumentInput,
  options: HistoricalBatchOptions,
): Promise<HistoricalBatchDocumentResult> {
  const { documentId, siteId, visitTitle } = doc
  const { userId } = options
  const extractionRetries = options.extractionRetries ?? 1

  const runId = await ensureExtractionRun(documentId, siteId, userId, extractionRetries)
  if (typeof runId !== 'string') return { documentId, ...runId }

  const run = await getExtractionRun(runId)
  if (!run || run.status === 'failed') {
    return {
      documentId, runId, status: 'quarantined', quarantineReason: 'EXTRACTION_FAILED',
      detail: run?.error_message ?? 'Run introuvable après extraction',
    }
  }

  // Idempotence : une visite existe déjà pour ce run → ne rejoue pas l'acceptation
  // ni la matérialisation, seulement le post-traitement (rejouable par construction).
  const existingSiteReportId = await getExistingMaterializedVisit(runId)
  let siteReportId: string
  let visitDate: string

  if (existingSiteReportId) {
    const admin = createAdminClient()
    const { data: docRow } = await admin
      .from('documents')
      .select('effective_date')
      .eq('id', documentId)
      .maybeSingle()
    const effectiveDate = (docRow as { effective_date: string | null } | null)?.effective_date
    if (!effectiveDate) {
      return { documentId, runId, siteReportId: existingSiteReportId, status: 'quarantined', quarantineReason: 'MISSING_DATE' }
    }
    siteReportId = existingSiteReportId
    visitDate = effectiveDate
  } else {
    const acceptResult = await acceptAllPendingForRun({ runId, userId })
    if (!acceptResult.ok) {
      return { documentId, runId, status: 'quarantined', quarantineReason: 'UNKNOWN_ERROR', detail: acceptResult.error }
    }

    // Garde non-visite : nonVisitAcknowledged reste TOUJOURS false ici. Le batch
    // n'a jamais le droit de confirmer à la place d'un humain (doctrine BATCH-0).
    const materializeResult = await materializeHistoricalRun({
      runId,
      documentId,
      userId,
      visitTitle: visitTitle ?? null,
      nonVisitAcknowledged: false,
    })

    if (!materializeResult.ok || !materializeResult.siteReportId || !materializeResult.visitDate) {
      return {
        documentId, runId, status: 'quarantined',
        quarantineReason: mapMaterializeErrorCode(materializeResult.errorCode),
        detail: materializeResult.error,
      }
    }

    siteReportId = materializeResult.siteReportId
    visitDate = materializeResult.visitDate
  }

  const postProcessingOutcome = await awaitPostProcessingWithRetry(
    { runId, siteId, siteReportId, visitDate },
    options.postProcessingMaxRetries ?? 5,
    options.postProcessingBackoffMs ?? 2000,
  )

  if (postProcessingOutcome !== 'completed' && postProcessingOutcome !== 'already_completed') {
    return {
      documentId, runId, siteReportId, status: 'quarantined',
      quarantineReason: postProcessingOutcome === 'failed' ? 'MATERIALIZATION_FAILED' : 'POST_PROCESSING_STUCK',
      detail: `Post-traitement non terminé (dernier statut : ${postProcessingOutcome})`,
      postProcessingOutcome,
    }
  }

  return {
    documentId, runId, siteReportId,
    status: existingSiteReportId ? 'already_materialized' : 'materialized',
    postProcessingOutcome,
  }
}

function mapMaterializeErrorCode(
  errorCode: string | undefined,
): BatchQuarantineReason {
  switch (errorCode) {
    case 'NON_VISIT_SIGNAL': return 'NON_VISIT_SIGNAL'
    case 'MISSING_DATE': return 'MISSING_DATE'
    case 'NO_SITE': return 'NO_SITE'
    case 'RUN_NOT_FOUND':
    case 'DOCUMENT_NOT_FOUND':
    case 'MATERIALIZATION_FAILED':
      return 'MATERIALIZATION_FAILED'
    default:
      return 'UNKNOWN_ERROR'
  }
}

/**
 * Résout le run d'extraction à utiliser : réutilise un run déjà exploitable,
 * refuse de dupliquer un run en cours, sinon lance extractHistoricalPv (la même
 * fonction que POST /api/extraction/historical-pv, appelée ici en direct — sans
 * after(), donc réellement attendue) avec un nombre borné de tentatives.
 */
async function ensureExtractionRun(
  documentId: string,
  siteId: string,
  userId: string,
  retries: number,
): Promise<string | Omit<HistoricalBatchDocumentResult, 'documentId'>> {
  const existingRun = await getLatestExtractionRunForDocument(documentId)
  if (existingRun && READY_STATUSES.has(existingRun.status)) {
    return existingRun.id
  }
  if (existingRun && (existingRun.status === 'pending' || existingRun.status === 'processing')) {
    return {
      runId: existingRun.id, status: 'quarantined', quarantineReason: 'EXTRACTION_ALREADY_RUNNING',
      detail: `Run ${existingRun.id} déjà en cours (${existingRun.status})`,
    }
  }

  const admin = createAdminClient()
  const { data: docRow } = await admin
    .from('documents')
    .select('organization_id, document_type')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!docRow) return { status: 'quarantined', quarantineReason: 'DOCUMENT_NOT_FOUND' }
  const d = docRow as { organization_id: string; document_type: string }

  let lastError: string | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    const runId = await createExtractionRun({
      document_id: documentId,
      organization_id: d.organization_id,
      extractor_key: d.document_type === 'construction_schedule' ? 'construction_schedule_v1' : 'historical_visit_report_v1',
      target_site_id: siteId,
      created_by: userId,
    })
    await extractHistoricalPv(documentId, userId, siteId, runId)
    const run = await getExtractionRun(runId)
    if (run && READY_STATUSES.has(run.status)) return runId
    lastError = run?.error_message ?? 'Extraction en échec'
  }

  return { status: 'quarantined', quarantineReason: 'EXTRACTION_FAILED', detail: lastError }
}

async function awaitPostProcessingWithRetry(
  params: Parameters<typeof runHistoricalImportPostProcessing>[0],
  maxRetries: number,
  initialBackoffMs: number,
): Promise<HistoricalImportPostProcessingOutcome> {
  let backoff = initialBackoffMs
  let outcome: HistoricalImportPostProcessingOutcome = 'failed'
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    outcome = await runHistoricalImportPostProcessing(params)
    if (outcome === 'completed' || outcome === 'already_completed' || outcome === 'failed') return outcome
    // 'concurrent' / 'lock_lost' : états transitoires du verrou à bail, on relance.
    if (attempt < maxRetries) {
      await sleep(backoff)
      backoff *= 2
    }
  }
  return outcome
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
