import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractPdfText, extractWithGeminiOCR } from '@/services/pdf/extract'
import { embedDocumentChunks } from '@/lib/ai/embed-knowledge-chunks'
import {
  updateDocumentAnalysisStatus,
  setDocumentExtraction,
} from '@/lib/db/documents'

// ============================================================================
// Pipeline d'analyse documentaire — phase 2 (spec 2026-05-19, décision I)
// ============================================================================
//
// Analysé UNE SEULE FOIS à l'upload (fire-and-forget via `after()`), ou sur
// relance explicite « Réanalyser ». JAMAIS déclenché à l'affichage
// (discipline coût IA). État machine :
//
//   pending → extracting → [ocr si scanné] → chunking → ready | failed
//
// ZÉRO GÉNÉRATION LLM : uniquement extraction (services/pdf/extract.ts) +
// OCR Gemini Vision existant + embeddings (knowledge_chunks). Aucun import
// d'orchestrateur/agent/générateur (garde-fou testé).
//
// Idempotent : la relance reconstruit extraction + chunks proprement.

const MIN_USABLE_CHARS = 100

function logSober(event: string, documentId: string, extra?: Record<string, unknown>) {
  // Log JSON une ligne, sobre (cohérent createTenderAction).
  console.error(
    JSON.stringify({ service: 'analyzeDocument', event, documentId, ...extra, ts: new Date().toISOString() }),
  )
}

/**
 * Analyse un document : télécharge le binaire, extrait le texte (OCR si
 * scanné), embède les chunks dans knowledge_chunks (source_domain='document'),
 * et fait évoluer `analysis_status`. Gère les erreurs avec `failed_reason`.
 */
export async function analyzeDocument(documentId: string): Promise<void> {
  const supabase = createAdminClient()

  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('id, storage_path')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (docErr || !doc) {
    logSober('document_introuvable', documentId, { error: docErr?.message })
    return
  }
  const storagePath = (doc as { storage_path: string }).storage_path

  try {
    await updateDocumentAnalysisStatus(documentId, 'extracting')

    const { data: blob, error: dlErr } = await supabase.storage
      .from('documents')
      .download(storagePath)
    if (dlErr || !blob) {
      await updateDocumentAnalysisStatus(documentId, 'failed', `download: ${dlErr?.message ?? 'no_blob'}`)
      return
    }
    const buffer = Buffer.from(await blob.arrayBuffer())

    let extracted = await extractPdfText(buffer)
    let extractionSource: 'native' | 'ocr' = 'native'

    if (extracted.isLikelyScanned) {
      await updateDocumentAnalysisStatus(documentId, 'ocr')
      let ocrText: string | null = null
      if (process.env.GOOGLE_GENAI_API_KEY) {
        try {
          ocrText = await extractWithGeminiOCR(buffer)
        } catch (e) {
          logSober('ocr_failed', documentId, { error: e instanceof Error ? e.message : String(e) })
        }
      }
      if (ocrText && ocrText.trim().length >= MIN_USABLE_CHARS) {
        extracted = { ...extracted, text: ocrText.trim() }
        extractionSource = 'ocr'
      } else {
        await updateDocumentAnalysisStatus(documentId, 'failed', 'scanned_pdf_unsupported')
        return
      }
    }

    const text = extracted.text.trim()
    if (text.length < MIN_USABLE_CHARS) {
      // Honnête : pas de texte exploitable → pas d'embeddings fabriqués.
      await updateDocumentAnalysisStatus(documentId, 'failed', 'no_extractable_text')
      return
    }

    await setDocumentExtraction(documentId, {
      extracted_text: text,
      extraction_source: extractionSource,
      page_count: extracted.pageCount,
    })

    await updateDocumentAnalysisStatus(documentId, 'chunking')
    // Embeddings uniquement (pas de génération). embedDocumentChunks
    // re-garde lui-même le seuil de texte exploitable.
    await embedDocumentChunks(documentId)

    await updateDocumentAnalysisStatus(documentId, 'ready')

    // B1 — résonances documentaires déterministes (fire-and-forget, pattern A3).
    // Import dynamique pour garder le module server-only hors graphe statique
    // d'éventuels tests. Erreurs silencieuses : la résonance est un bonus,
    // jamais bloquante pour l'analyse réussie.
    try {
      const { computeDocResonancesForDocument } = await import('./resonances')
      void computeDocResonancesForDocument(documentId).catch(() => {})
    } catch {
      // module absent ou import KO → ignoré
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logSober('pipeline_error', documentId, { error: msg })
    await updateDocumentAnalysisStatus(documentId, 'failed', msg).catch(() => {})
  }
}
