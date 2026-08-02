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
import { mapDocumentStatus, reconcileSubjectThreads } from './subject-reconciliation'
import type { DocumentProposalFamily, DocumentEvidenceType, DocumentEvidenceRelationType } from '@/types/db'

const EXTRACTOR_KEY = 'historical_visit_report_v1'
const EXTRACTOR_VERSION = '1.0.0'
const MIN_USABLE_CHARS = 100
const MAX_SNAPSHOT_PAGES = 10
// Plafond de légendes IA par run : au-delà, caption = null (trop long sinon).
const MAX_CAPTIONS = 20
// Concurrence des appels Gemini pour les légendes (I/O bound, pas CPU).
const CAPTION_CONCURRENCY = 5

function log(event: string, documentId: string, extra?: Record<string, unknown>) {
  console.error(
    JSON.stringify({ service: 'extractHistoricalPv', event, documentId, ...extra, ts: new Date().toISOString() }),
  )
}

export async function extractHistoricalPv(
  documentId: string,
  userId?: string | null,
  siteId?: string | null,
  preCreatedRunId?: string,
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

  // 2. Créer le run en état pending (sauf si déjà créé par la route)
  let runId: string
  if (preCreatedRunId) {
    runId = preCreatedRunId
  } else {
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
    runId = await createExtractionRun({
      document_id: documentId,
      organization_id: d.organization_id,
      extractor_key: EXTRACTOR_KEY,
      extractor_version: EXTRACTOR_VERSION,
      target_site_id: resolvedSiteId ?? undefined,
      created_by: userId ?? null,
    })
  }

  try {
    log('extraction_start', documentId, { runId })
    await updateExtractionRunStatus(runId, 'processing', { started_at: new Date().toISOString() })
    await updateExtractionStage(runId, 'downloading')

    // 3. Télécharger le fichier
    log('step_downloading', documentId, { runId })
    const { data: blob, error: dlErr } = await supabase.storage
      .from('documents')
      .download(d.storage_path)
    if (dlErr || !blob) {
      throw new Error(`download: ${dlErr?.message ?? 'no_blob'}`)
    }
    const buffer = Buffer.from(await blob.arrayBuffer())
    await updateExtractionStage(runId, 'extracting_text')

    // 4. Extraction texte native, OCR si scanné
    log('step_extracting_text', documentId, { runId })
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
    log('text_extracted', documentId, { runId, chars: text.length, pages: extracted.pageCount })
    await updateExtractionStage(runId, 'rendering_pages')

    // 5. Rendu des snapshots de pages (mupdf, graceful fallback)
    // Plafonné à MAX_SNAPSHOT_PAGES pour rester dans le budget temps Vercel.
    log('step_rendering_pages', documentId, { runId })
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
    log('pages_rendered', documentId, { runId, pages: pagesToRender })

    await updateExtractionStage(runId, 'extracting_images')

    // 5b. Extraction des objets image embarqués (approche native PDF, sans vision)
    // Chaque image découverte devient une evidence de type 'image', indépendante des propositions LLM.
    //
    // PERFORMANCE : l'extraction mupdf est séquentielle (thread-safety). En revanche,
    // le légendes IA (I/O réseau pur) sont traitées en parallèle par lot de CAPTION_CONCURRENCY,
    // plafonnées à MAX_CAPTIONS. Sur un PV avec 30 photos, cela divise le temps de légende
    // par ~5 et garantit le respect du timeout Vercel à 300 s.
    log('step_extracting_images', documentId, { runId })
    const { extractPageImages } = await import('@/services/pdf/extract-images')
    const { generateImageCaption } = await import('@/services/pdf/caption-image')
    type ImageInfo = { storagePath: string; pageNum: number; nativeWidth: number; nativeHeight: number; bbox: [number, number, number, number]; caption: string | null }
    type RawImage = { buffer: Buffer; storagePath: string; pageNum: number; nativeWidth: number; nativeHeight: number; bbox: [number, number, number, number]; pageText: string }
    const rawImages: RawImage[] = []

    // Passe 1 : extraction mupdf et upload (séquentiels — mupdf n'est pas thread-safe)
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
          rawImages.push({ buffer: img.buffer, storagePath, pageNum, nativeWidth: img.nativeWidth, nativeHeight: img.nativeHeight, bbox: img.bbox, pageText: pageResult.pageText })
        } else {
          log('image_upload_failed', documentId, { page: pageNum, idx: i, error: uploadErr.message })
        }
      }
    }
    log('images_extracted_raw', documentId, { runId, count: rawImages.length })

    // Passe 2 : légendes IA en parallèle par lots, plafonnées à MAX_CAPTIONS
    const toCaption = rawImages.slice(0, MAX_CAPTIONS)
    const captionMap = new Map<string, string | null>()
    for (let b = 0; b < toCaption.length; b += CAPTION_CONCURRENCY) {
      const batch = toCaption.slice(b, b + CAPTION_CONCURRENCY)
      await Promise.all(
        batch.map(async (raw) => {
          let caption: string | null = null
          try {
            caption = await generateImageCaption(raw.buffer, raw.pageText)
          } catch { /* caption reste null */ }
          captionMap.set(raw.storagePath, caption)
        }),
      )
    }
    log('captions_done', documentId, { runId, captioned: toCaption.length, total: rawImages.length })

    const extractedImageInfos: ImageInfo[] = rawImages.map((raw) => ({
      storagePath: raw.storagePath,
      pageNum: raw.pageNum,
      nativeWidth: raw.nativeWidth,
      nativeHeight: raw.nativeHeight,
      bbox: raw.bbox,
      caption: captionMap.get(raw.storagePath) ?? null,
    }))
    log('images_extracted', documentId, { count: extractedImageInfos.length })

    await updateExtractionStage(runId, 'llm_analysis')
    log('step_llm_analysis', documentId, { runId })

    // 6. Extraction LLM structurée
    const llmResult = await extractHistoricalPvProposals(text, extracted.pageCount)

    // 6b. Fallback photo : pages identifiées comme photo par le LLM
    // mais dont extractPageImages n'a extrait aucune image native.
    // On promeut le snapshot déjà rendu en preuve 'image' (même fichier stocké,
    // pas de re-upload) pour qu'il soit compté et affiché comme une vraie photo.
    {
      const llmPhotoPages = new Set(
        llmResult.evidence
          .filter((ev) => ev.evidenceType === 'page_snapshot')
          .map((ev) => ev.sourcePage),
      )
      for (const pageNum of llmPhotoPages) {
        const alreadyExtracted = extractedImageInfos.some((i) => i.pageNum === pageNum)
        if (!alreadyExtracted) {
          const snapPath = snapshotPaths.get(pageNum)
          if (snapPath) {
            extractedImageInfos.push({
              storagePath: snapPath,
              pageNum,
              nativeWidth: 0,
              nativeHeight: 0,
              bbox: [0, 0, 0, 0] as [number, number, number, number],
              caption: null,
            })
            log('snapshot_promoted_to_image', documentId, { page: pageNum })
          }
        }
      }
    }

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

    const evidenceResults = await insertExtractionEvidence(runId, evidenceInputs)
    const evidenceKeyToId = new Map<string, string>()
    llmResult.evidence.forEach((ev, i) => {
      evidenceKeyToId.set(ev.temporaryKey, evidenceResults[i].id)
    })

    // 8. Persister les propositions
    const proposalInputs = llmResult.proposals.map((p) => {
      const payload = p.sourcePayload as { thematic_category?: string; statusAtDocumentDate?: string } | null | undefined
      return {
        organization_id: d.organization_id,
        document_id: documentId,
        proposal_family: p.family as DocumentProposalFamily,
        stable_key: p.temporaryKey,
        label: p.label,
        description: p.description ?? null,
        source_page: p.sourcePage ?? null,
        source_excerpt: p.sourceExcerpt ?? null,
        source_payload: (payload as Record<string, unknown> | null | undefined) ?? null,
        thematic_category: payload?.thematic_category ?? null,
        document_status: mapDocumentStatus(payload?.statusAtDocumentDate, p.family),
      }
    })

    const proposalIds = await insertExtractionProposals(runId, proposalInputs)
    const proposalKeyToId = new Map<string, string>()
    llmResult.proposals.forEach((p, i) => {
      proposalKeyToId.set(p.temporaryKey, proposalIds[i])
    })

    // 9. Lier preuves ↔ propositions
    // Seules les familles visuellement observables peuvent recevoir un lien photo automatique.
    // knowledge_fact, deadline, decision, person, company → jamais de lien supports automatique.
    const PHOTO_LINKABLE_FAMILIES = new Set(['reservation', 'observation', 'action'])
    for (const proposal of llmResult.proposals) {
      if (!PHOTO_LINKABLE_FAMILIES.has(proposal.family)) continue
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
      const imageEvidenceResults = await insertExtractionEvidence(runId, imageEvidenceInputs)
      const storagePathToEvidenceId = new Map(
        imageEvidenceResults.map((r) => [r.storage_path, r.id]),
      )

      // 10b. Candidats par proximité de page — SUPPRIMÉ
      // La coprésence sur une page ne constitue pas une preuve visuelle.
      // Sur les PV denses (ex. page 8 avec 10+ propositions), une seule photo
      // se retrouvait suggérée pour tous les sujets de la page, créant
      // autant de faux positifs que d'associations.
      // Seuls les liens 'supports' créés par le LLM à l'étape 9 sont conservés.
    }

    // 11. Run terminé
    await updateExtractionRunStatus(runId, 'ready_for_review', {
      completed_at: new Date().toISOString(),
    })

    // 11b. Ce run devient le run canonique du document.
    // Les re-analyses précédentes (is_canonical = true) sont rétrogradées.
    await supabase.from('document_extraction_run')
      .update({ is_canonical: false })
      .eq('document_id', documentId)
      .neq('id', runId)
    await supabase.from('document_extraction_run')
      .update({ is_canonical: true })
      .eq('id', runId)

    // 12. Réconciliation des fils thématiques inter-PV (déterministe, sans LLM)
    // Si le document n'est pas rattaché à un chantier, la réconciliation n'a pas de sens.
    let siteIdForReconciliation: string | null = null
    {
      const { data: link } = await supabase
        .from('document_extraction_run')
        .select('target_site_id')
        .eq('id', runId)
        .maybeSingle()
      siteIdForReconciliation = (link as { target_site_id: string | null } | null)?.target_site_id ?? null
    }
    if (siteIdForReconciliation) {
      try {
        const { matched, created } = await reconcileSubjectThreads(runId, siteIdForReconciliation)
        log('subject_threads_reconciled', documentId, { runId, matched, created })
      } catch (reconcileErr) {
        // Non bloquant : l'extraction est terminée même si la réconciliation échoue
        log('subject_threads_reconciliation_failed', documentId, {
          runId,
          error: reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr),
        })
      }
    }

    log('extraction_complete', documentId, {
      runId,
      proposals: llmResult.proposals.length,
      evidence: llmResult.evidence.length,
    })
  } catch (e) {
    const raw = e instanceof Error ? e.message : (e != null && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))
    const msg = raw || 'erreur inconnue — voir logs Vercel'
    log('extraction_failed', documentId, { runId, error: msg })
    await updateExtractionRunStatus(runId, 'failed', {
      error_message: msg,
      completed_at: new Date().toISOString(),
    }).catch((updateErr) => {
      console.error('[extractHistoricalPv] failed to mark run as failed:', updateErr)
    })
  }
}
