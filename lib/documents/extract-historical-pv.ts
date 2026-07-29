import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractPdfText, extractWithGeminiOCR } from '@/services/pdf/extract'
import { renderPdfPage } from '@/services/pdf/render-page'
import { extractHistoricalPvProposals } from './historical-visit-extractor'
import {
  createExtractionRun,
  updateExtractionRunStatus,
  insertExtractionProposals,
  insertExtractionEvidence,
  linkProposalEvidence,
} from '@/lib/db/document-extractions'
import type { DocumentProposalFamily, DocumentEvidenceType, DocumentEvidenceRelationType } from '@/types/db'

const EXTRACTOR_KEY = 'historical_visit_report_v1'
const EXTRACTOR_VERSION = '1.0.0'
const MIN_USABLE_CHARS = 100

function log(event: string, documentId: string, extra?: Record<string, unknown>) {
  console.error(
    JSON.stringify({ service: 'extractHistoricalPv', event, documentId, ...extra, ts: new Date().toISOString() }),
  )
}

export async function extractHistoricalPv(
  documentId: string,
  userId?: string | null,
  siteId?: string | null,
): Promise<void> {
  const supabase = createAdminClient()

  // 1. Vérifier le document
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('id, storage_path, organization_id, document_type')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle()

  if (docErr || !doc) {
    log('document_introuvable', documentId, { error: docErr?.message })
    return
  }

  const d = doc as { id: string; storage_path: string; organization_id: string; document_type: string }

  if (d.document_type !== 'historical_visit_report') {
    log('wrong_document_type', documentId, { document_type: d.document_type })
    return
  }

  // 2. Créer le run en état pending
  // target_site_id : fourni explicitement ou résolu depuis document_links
  let resolvedSiteId = siteId ?? null
  if (!resolvedSiteId) {
    const { data: link } = await supabase
      .from('document_links')
      .select('target_id')
      .eq('document_id', documentId)
      .eq('target_type', 'site')
      .maybeSingle()
    resolvedSiteId = (link as { target_id: string } | null)?.target_id ?? null
  }

  const runId = await createExtractionRun({
    document_id: documentId,
    organization_id: d.organization_id,
    extractor_key: EXTRACTOR_KEY,
    extractor_version: EXTRACTOR_VERSION,
    target_site_id: resolvedSiteId ?? undefined,
    created_by: userId ?? null,
  })

  try {
    await updateExtractionRunStatus(runId, 'processing', { started_at: new Date().toISOString() })

    // 3. Télécharger le fichier
    const { data: blob, error: dlErr } = await supabase.storage
      .from('documents')
      .download(d.storage_path)
    if (dlErr || !blob) {
      throw new Error(`download: ${dlErr?.message ?? 'no_blob'}`)
    }
    const buffer = Buffer.from(await blob.arrayBuffer())

    // 4. Extraction texte native, OCR si scanné
    let extracted = await extractPdfText(buffer)
    let text = extracted.text

    if (extracted.isLikelyScanned || extracted.charCount < MIN_USABLE_CHARS) {
      if (process.env.GOOGLE_GENAI_API_KEY) {
        try {
          const ocrText = await extractWithGeminiOCR(buffer)
          if (ocrText && ocrText.trim().length >= MIN_USABLE_CHARS) {
            text = ocrText.trim()
            extracted = { ...extracted, text }
          }
        } catch (e) {
          log('ocr_failed', documentId, { error: e instanceof Error ? e.message : String(e) })
        }
      }
    }

    if (text.trim().length < MIN_USABLE_CHARS) {
      throw new Error('no_extractable_text')
    }

    // 5. Rendu des snapshots de pages (mupdf, graceful fallback)
    // Map page 1-based → storage_path | null
    const snapshotPaths = new Map<number, string | null>()
    for (let pageNum = 1; pageNum <= extracted.pageCount; pageNum++) {
      const rendered = await renderPdfPage(buffer, pageNum - 1)
      if (rendered) {
        const storagePath = `snapshots/${documentId}/page-${pageNum}.png`
        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(storagePath, rendered.buffer, { contentType: 'image/png', upsert: true })
        if (!uploadErr) {
          snapshotPaths.set(pageNum, storagePath)
        } else {
          log('snapshot_upload_failed', documentId, { page: pageNum, error: uploadErr.message })
          snapshotPaths.set(pageNum, null)
        }
      } else {
        snapshotPaths.set(pageNum, null)
      }
    }

    // 6. Extraction LLM structurée
    const llmResult = await extractHistoricalPvProposals(text, extracted.pageCount)

    // 7. Persister les preuves
    const evidenceInputs = llmResult.evidence.map((ev) => ({
      organization_id: d.organization_id,
      document_id: documentId,
      evidence_type: ev.evidenceType as DocumentEvidenceType,
      source_page: ev.sourcePage,
      storage_path: ev.evidenceType === 'page_snapshot'
        ? (snapshotPaths.get(ev.sourcePage) ?? null)
        : null,
      caption: ev.caption ?? null,
      nearby_text: ev.nearbyText ?? null,
      metadata: ev.text ? { text: ev.text } : null,
    }))

    const evidenceIds = await insertExtractionEvidence(runId, evidenceInputs)
    const evidenceKeyToId = new Map<string, string>()
    llmResult.evidence.forEach((ev, i) => {
      evidenceKeyToId.set(ev.temporaryKey, evidenceIds[i])
    })

    // 8. Persister les propositions
    const proposalInputs = llmResult.proposals.map((p) => ({
      organization_id: d.organization_id,
      document_id: documentId,
      proposal_family: p.family as DocumentProposalFamily,
      stable_key: p.temporaryKey,
      label: p.label,
      description: p.description ?? null,
      source_page: p.sourcePage ?? null,
      source_excerpt: p.sourceExcerpt ?? null,
      source_payload: (p.sourcePayload as Record<string, unknown> | null | undefined) ?? null,
    }))

    const proposalIds = await insertExtractionProposals(runId, proposalInputs)
    const proposalKeyToId = new Map<string, string>()
    llmResult.proposals.forEach((p, i) => {
      proposalKeyToId.set(p.temporaryKey, proposalIds[i])
    })

    // 9. Lier preuves ↔ propositions
    for (const proposal of llmResult.proposals) {
      const proposalId = proposalKeyToId.get(proposal.temporaryKey)
      if (!proposalId) continue
      for (const evidenceKey of proposal.evidenceKeys) {
        const evidenceId = evidenceKeyToId.get(evidenceKey)
        if (!evidenceId) continue
        await linkProposalEvidence(proposalId, evidenceId, 'supports' as DocumentEvidenceRelationType)
      }
    }

    // 10. Run terminé
    await updateExtractionRunStatus(runId, 'ready_for_review', {
      completed_at: new Date().toISOString(),
    })

    log('extraction_complete', documentId, {
      runId,
      proposals: llmResult.proposals.length,
      evidence: llmResult.evidence.length,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('extraction_failed', documentId, { runId, error: msg })
    await updateExtractionRunStatus(runId, 'failed', {
      error_message: msg,
      completed_at: new Date().toISOString(),
    }).catch(() => {})
  }
}
