import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractPdfText, extractWithGeminiOCR } from '@/services/pdf/extract'
import { renderPdfPage } from '@/services/pdf/render-page'
import { extractHistoricalPvProposals } from './historical-visit-extractor'
import {
  createExtractionRun,
  updateExtractionRunStatus,
  updateExtractionStage,
  insertExtractionProposals,
  insertExtractionEvidence,
  linkProposalEvidence,
} from '@/lib/db/document-extractions'
import type { DocumentProposalFamily, DocumentEvidenceType, DocumentEvidenceRelationType } from '@/types/db'

const EXTRACTOR_KEY = 'historical_visit_report_v1'
const EXTRACTOR_VERSION = '1.0.0'
const MIN_USABLE_CHARS = 100
const MAX_SNAPSHOT_PAGES = 10

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
    await updateExtractionStage(runId, 'downloading')

    // 3. Télécharger le fichier
    const { data: blob, error: dlErr } = await supabase.storage
      .from('documents')
      .download(d.storage_path)
    if (dlErr || !blob) {
      throw new Error(`download: ${dlErr?.message ?? 'no_blob'}`)
    }
    const buffer = Buffer.from(await blob.arrayBuffer())
    await updateExtractionStage(runId, 'extracting_text')

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
    await updateExtractionStage(runId, 'rendering_pages')

    // 5. Rendu des snapshots de pages (mupdf, graceful fallback)
    // Plafonné à MAX_SNAPSHOT_PAGES pour rester dans le budget temps Vercel.
    const pagesToRender = Math.min(extracted.pageCount, MAX_SNAPSHOT_PAGES)
    const snapshotPaths = new Map<number, string | null>()
    for (let pageNum = 1; pageNum <= pagesToRender; pageNum++) {
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

    await updateExtractionStage(runId, 'extracting_images')

    // 5b. Extraction des objets image embarqués (approche native PDF, sans vision)
    // Chaque image découverte devient une evidence de type 'image', indépendante des propositions LLM.
    const { extractPageImages } = await import('@/services/pdf/extract-images')
    const { generateImageCaption } = await import('@/services/pdf/caption-image')
    type ImageInfo = { storagePath: string; pageNum: number; nativeWidth: number; nativeHeight: number; bbox: [number, number, number, number]; caption: string | null }
    const extractedImageInfos: ImageInfo[] = []
    for (let pageNum = 1; pageNum <= pagesToRender; pageNum++) {
      let pageResult: Awaited<ReturnType<typeof extractPageImages>> = { images: [], pageText: '' }
      try {
        pageResult = await extractPageImages(buffer, pageNum - 1)
      } catch {
        // page ignorée si extraction échoue
      }
      for (let i = 0; i < pageResult.images.length; i++) {
        const img = pageResult.images[i]
        const storagePath = `snapshots/${documentId}/img-p${pageNum}-${i + 1}.png`
        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(storagePath, img.buffer, { contentType: 'image/png', upsert: true })
        if (!uploadErr) {
          // Légende IA basée sur le texte de la page (best-effort, non bloquant)
          let caption: string | null = null
          try {
            caption = await generateImageCaption(img.buffer, pageResult.pageText)
          } catch { /* caption reste null */ }
          extractedImageInfos.push({ storagePath, pageNum, nativeWidth: img.nativeWidth, nativeHeight: img.nativeHeight, bbox: img.bbox, caption })
        } else {
          log('image_upload_failed', documentId, { page: pageNum, idx: i, error: uploadErr.message })
        }
      }
    }
    log('images_extracted', documentId, { count: extractedImageInfos.length })

    await updateExtractionStage(runId, 'llm_analysis')

    // 6. Extraction LLM structurée
    const llmResult = await extractHistoricalPvProposals(text, extracted.pageCount)

    await updateExtractionStage(runId, 'persisting')

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

    // 10. Insérer les images extraites comme evidence indépendante (orphanes)
    if (extractedImageInfos.length > 0) {
      const imageEvidenceInputs = extractedImageInfos.map((info) => ({
        organization_id: d.organization_id,
        document_id: documentId,
        evidence_type: 'image' as DocumentEvidenceType,
        source_page: info.pageNum,
        storage_path: info.storagePath,
        caption: info.caption,
        nearby_text: null,
        metadata: {
          nativeWidth: info.nativeWidth,
          nativeHeight: info.nativeHeight,
          bbox: info.bbox,
        },
      }))
      await insertExtractionEvidence(runId, imageEvidenceInputs)
    }

    // 11. Run terminé
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
