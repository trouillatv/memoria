// BATCH-1 — inventaire chronologique du corpus historique AVANT tout import réel.
//
// Strictement en lecture seule : parcourt un dossier local de PDF, calcule leur hash,
// les rapproche des documents déjà en base pour le chantier ciblé, lit le statut du
// dernier run d'extraction et de la mémoire canonique (via decideReconcileLock, la
// même fonction pure que runHistoricalImportPostProcessing utilise pour décider
// 'done'/'concurrent'/'acquire' — pas de réimplémentation du critère). AUCUNE écriture,
// aucun appel LLM (extractPdfText seul — jamais extractWithGeminiOCR), aucun appel à
// runHistoricalImportPostProcessing lui-même.
//
// La date candidate est détectée via detectDocumentDate() sur le texte natif PDF, pour
// permettre le tri chronologique même sur les documents pas encore en base.

import 'server-only'

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { createAdminClient } from '@/lib/supabase/admin'
import { extractPdfText } from '@/services/pdf/extract'
import { detectDocumentDate, detectNonVisitSignal } from '@/lib/documents/detect-document-date'
import { getLatestExtractionRunForDocument } from '@/lib/db/document-extractions'
import { getExistingMaterializedVisit } from '@/lib/db/historical-visit-materialization'
import { decideReconcileLock } from '@/lib/db/canonical-subject-source-reconcile'
import { READY_STATUSES } from './historical-import-batch'

export type HistoricalInventoryClass =
  | 'IMPORT'
  | 'RESUME_EXTRACTION'
  | 'RESUME_MATERIALIZATION'
  | 'RESUME_POST_PROCESSING'
  | 'SKIP_ALREADY_COMPLETE'
  | 'QUARANTINE_DATE'
  | 'QUARANTINE_NON_VISIT'
  | 'MISSING_DOCUMENT_REGISTRATION'
  | 'ERROR'

export type HistoricalInventoryMemoryStatus = 'complete' | 'incomplete' | 'locked' | 'not_materialized'

export interface HistoricalInventoryEntry {
  filePath: string
  fileName: string
  contentHashSha256: string
  documentId: string | null
  organizationId: string | null
  effectiveDate: string | null
  detectedDate: string | null
  detectedDateEvidence: string | null
  ambiguousDate: boolean
  nonVisitDetected: boolean
  nonVisitEvidence: string | null
  extractionRunId: string | null
  extractionRunStatus: string | null
  siteReportId: string | null
  memoryStatus: HistoricalInventoryMemoryStatus | null
  sortDate: string | null
  sortDateSource: 'effective_date' | 'detected_date' | 'none'
  klass: HistoricalInventoryClass
  reason: string
}

export interface HistoricalInventoryOptions {
  /** Dossier local absolu contenant les PDF, parcouru récursivement. */
  folderPath: string
  siteId: string
}

const PDF_EXT = '.pdf'

async function listPdfFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(PDF_EXT)) out.push(full)
    }
  }
  await walk(root)
  return out.sort((a, b) => a.localeCompare(b))
}

interface MatchedDocument {
  id: string
  organization_id: string | null
  filename: string
  content_hash: string | null
  effective_date: string | null
}

interface ClassifyInput {
  matched: MatchedDocument | null
  readError: string | null
  siteReportId: string | null
  memoryStatus: HistoricalInventoryMemoryStatus | null
  nonVisitDetected: boolean
  ambiguousDate: boolean
  sortDate: string | null
  runId: string | null
  runStatus: string | null
}

function classify(input: ClassifyInput): { klass: HistoricalInventoryClass; reason: string } {
  if (!input.matched) {
    return {
      klass: 'MISSING_DOCUMENT_REGISTRATION',
      reason: 'Aucun document en base rattaché à ce chantier (ni content_hash ni filename ne correspond).',
    }
  }
  if (input.readError) {
    return { klass: 'ERROR', reason: `Lecture du PDF impossible : ${input.readError}` }
  }

  if (input.siteReportId) {
    if (input.memoryStatus === 'complete') {
      return {
        klass: 'SKIP_ALREADY_COMPLETE',
        reason: 'Visite matérialisée, canonicalisation et similarité déjà terminées — aucune écriture si rejoué.',
      }
    }
    return {
      klass: 'RESUME_POST_PROCESSING',
      reason: input.memoryStatus === 'locked'
        ? 'Visite matérialisée, verrou canonique actif (bail TTL en cours) — à revérifier après expiration, pas de nouvelle écriture immédiate.'
        : 'Visite déjà matérialisée mais mémoire (canonicalisation/similarité) incomplète — runHistoricalImportPostProcessing doit reprendre, jamais un simple SKIP.',
    }
  }

  if (input.nonVisitDetected) {
    return { klass: 'QUARANTINE_NON_VISIT', reason: 'Signal « pas de visite terrain » détecté dans le texte — confirmation humaine requise avant matérialisation.' }
  }
  if (!input.sortDate || input.ambiguousDate) {
    return {
      klass: 'QUARANTINE_DATE',
      reason: input.ambiguousDate
        ? 'Plusieurs dates de visite plausibles détectées dans le texte — l\'humain doit trancher.'
        : 'Aucune date de visite détectable dans le texte natif du document.',
    }
  }

  if (input.runId && (input.runStatus === 'pending' || input.runStatus === 'processing')) {
    return {
      klass: 'RESUME_EXTRACTION',
      reason: `Run d'extraction ${input.runId} déjà en cours (${input.runStatus}) — le batch ne le duplique pas ; à vérifier manuellement avant lancement.`,
    }
  }
  if (input.runId && input.runStatus && READY_STATUSES.has(input.runStatus)) {
    return {
      klass: 'RESUME_MATERIALIZATION',
      reason: `Extraction déjà exploitable (run ${input.runId}, statut ${input.runStatus}) — accepter et matérialiser sans relancer le LLM.`,
    }
  }
  return {
    klass: 'IMPORT',
    reason: input.runId
      ? `Dernier run (${input.runStatus}) inexploitable — nouvelle extraction complète à lancer.`
      : 'Aucun run d\'extraction existant — pipeline complet (extraction → matérialisation → mémoire) à lancer.',
  }
}

/**
 * Construit l'inventaire chronologique d'un dossier local de PV/CR historiques pour
 * UN chantier. Ne modifie rien : aucune ligne `documents`, aucun run d'extraction,
 * aucune matérialisation, aucun appel LLM.
 */
export async function buildHistoricalCorpusInventory(
  options: HistoricalInventoryOptions,
): Promise<HistoricalInventoryEntry[]> {
  const { folderPath, siteId } = options
  const admin = createAdminClient()
  const files = await listPdfFilesRecursive(folderPath)

  const { data: linkedDocIdsRaw } = await admin
    .from('document_links')
    .select('document_id')
    .eq('target_type', 'site')
    .eq('target_id', siteId)
  const docIds = [...new Set((linkedDocIdsRaw ?? []).map((r) => (r as { document_id: string }).document_id))]

  const { data: docsRaw } = docIds.length > 0
    ? await admin
        .from('documents')
        .select('id, organization_id, filename, content_hash, effective_date')
        .in('id', docIds)
        .is('deleted_at', null)
    : { data: [] as MatchedDocument[] }
  const docs = (docsRaw ?? []) as MatchedDocument[]
  const byHash = new Map(docs.filter((d) => d.content_hash).map((d) => [d.content_hash as string, d]))
  const byFilename = new Map(docs.map((d) => [d.filename, d]))

  const entries: HistoricalInventoryEntry[] = []

  for (const filePath of files) {
    const fileName = path.basename(filePath)
    const buffer = await readFile(filePath)
    const contentHashSha256 = createHash('sha256').update(buffer).digest('hex')
    const matched = byHash.get(contentHashSha256) ?? byFilename.get(fileName) ?? null

    let detectedDate: string | null = null
    let detectedDateEvidence: string | null = null
    let ambiguousDate = false
    let nonVisitDetected = false
    let nonVisitEvidence: string | null = null
    let readError: string | null = null
    try {
      // Texte natif uniquement — jamais extractWithGeminiOCR (BATCH-1 = zéro appel LLM).
      const extracted = await extractPdfText(buffer)
      const dateDetection = detectDocumentDate(extracted.text)
      detectedDate = dateDetection.best?.iso ?? null
      detectedDateEvidence = dateDetection.best?.evidence ?? null
      ambiguousDate = dateDetection.ambiguous
      const nonVisit = detectNonVisitSignal(extracted.text)
      nonVisitDetected = nonVisit.detected
      nonVisitEvidence = nonVisit.evidence
    } catch (e) {
      readError = e instanceof Error ? e.message : String(e)
    }

    let runId: string | null = null
    let runStatus: string | null = null
    let siteReportId: string | null = null
    let memoryStatus: HistoricalInventoryMemoryStatus | null = null

    if (matched) {
      const run = await getLatestExtractionRunForDocument(matched.id)
      runId = run?.id ?? null
      runStatus = run?.status ?? null
      siteReportId = run ? await getExistingMaterializedVisit(run.id) : null

      if (siteReportId) {
        const { data: reportStatusRaw } = await admin
          .from('site_reports')
          .select('canonical_reconciled_at, canonical_reconcile_started_at, similarity_analysis_completed_at, similarity_analysis_error')
          .eq('id', siteReportId)
          .maybeSingle()
        const typedStatus = reportStatusRaw as {
          canonical_reconciled_at?: string | null
          canonical_reconcile_started_at?: string | null
          similarity_analysis_completed_at?: string | null
          similarity_analysis_error?: string | null
        } | null
        const decision = decideReconcileLock(typedStatus, Date.now())
        if (decision === 'done' && typedStatus?.similarity_analysis_completed_at && !typedStatus.similarity_analysis_error) {
          memoryStatus = 'complete'
        } else if (decision === 'concurrent') {
          memoryStatus = 'locked'
        } else {
          memoryStatus = 'incomplete'
        }
      } else {
        memoryStatus = 'not_materialized'
      }
    }

    const sortDate = matched?.effective_date ?? detectedDate
    const sortDateSource: HistoricalInventoryEntry['sortDateSource'] =
      matched?.effective_date ? 'effective_date' : detectedDate ? 'detected_date' : 'none'

    const { klass, reason } = classify({
      matched, readError, siteReportId, memoryStatus, nonVisitDetected, ambiguousDate,
      sortDate, runId, runStatus,
    })

    entries.push({
      filePath, fileName, contentHashSha256,
      documentId: matched?.id ?? null,
      organizationId: matched?.organization_id ?? null,
      effectiveDate: matched?.effective_date ?? null,
      detectedDate, detectedDateEvidence, ambiguousDate,
      nonVisitDetected, nonVisitEvidence,
      extractionRunId: runId, extractionRunStatus: runStatus,
      siteReportId, memoryStatus,
      sortDate, sortDateSource, klass, reason,
    })
  }

  return entries.sort((a, b) => (a.sortDate ?? '9999-99-99').localeCompare(b.sortDate ?? '9999-99-99'))
}
