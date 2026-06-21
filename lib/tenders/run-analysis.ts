// Exécution de l'analyse d'un AO — fonction PARTAGÉE (Vincent 2026-06-21).
//
// Avant : l'analyse tournait dans un `after()` post-réponse, que Vercel COUPE →
// l'AO restait coincé « analyzing » indéfiniment. Désormais elle tourne dans une
// vraie requête HTTP (route /analyze déclenchée par le client), qui garde la
// fonction serverless vivante jusqu'au bout. Cette fonction est le cœur partagé,
// appelée par la route ; bornée par un garde-temps ; idempotente (ne relance pas
// un AO déjà « ready »).

import { getTender, getTenderDocument, updateTenderStatus, insertTenderAnalysis } from '@/lib/db/tenders'
import { analyzeTender } from '@/services/ai/orchestrator'
import { validateAnalysisSources } from '@/services/ai/source-validation'
import { listKnowledgeItems } from '@/lib/db/knowledge'
import { extractPdfText, extractWithGeminiOCR } from '@/services/pdf/extract'
import { createAdminClient } from '@/lib/supabase/admin'

const EXTRACT_TIMEOUT_MS = 90_000
const OCR_TIMEOUT_MS = 120_000
const ANALYZE_TIMEOUT_MS = 180_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} : délai dépassé (${Math.round(ms / 1000)}s)`)), ms),
    ),
  ])
}

export type RunAnalysisResult =
  | { ok: true; score: number | null; alreadyDone?: boolean }
  | { ok: false; error: string }

/**
 * Lance (ou reprend) l'analyse d'un AO et écrit le résultat + le statut.
 * Idempotent : si l'AO est déjà « ready », on ne relance pas.
 */
export async function runTenderAnalysis(tenderId: string, userId: string | null): Promise<RunAnalysisResult> {
  const tender = await getTender(tenderId)
  if (!tender) return { ok: false, error: 'AO introuvable' }
  if (tender.status === 'ready') return { ok: true, score: tender.opportunity_score ?? null, alreadyDone: true }

  const doc = await getTenderDocument(tenderId)
  if (!doc) {
    await updateTenderStatus(tenderId, 'failed', 'no document')
    return { ok: false, error: 'Aucun document attaché' }
  }

  // ÉTAPE 1 — EXTRACTION (déplacée hors du formulaire d'upload, où pdf-parse
  // bloquait le thread). On télécharge le PDF du stockage et on extrait ici,
  // dans la requête HTTP (bornée). OCR de secours si PDF scanné.
  let extractedText = (doc.extracted_text ?? '').trim()
  if (!extractedText) {
    try {
      await updateTenderStatus(tenderId, 'extracting')
      const supabase = createAdminClient()
      const { data: blob } = await supabase.storage.from('tender-documents').download(doc.storage_path)
      if (!blob) throw new Error('PDF introuvable dans le stockage')
      const buffer = Buffer.from(await blob.arrayBuffer())

      let extracted = await withTimeout(extractPdfText(buffer), EXTRACT_TIMEOUT_MS, 'Extraction PDF')
      if (extracted.isLikelyScanned && process.env.GOOGLE_GENAI_API_KEY) {
        try {
          const ocr = await withTimeout(extractWithGeminiOCR(buffer), OCR_TIMEOUT_MS, 'OCR')
          if (ocr && ocr.trim()) extracted = { ...extracted, text: ocr, isLikelyScanned: false }
        } catch (ocrErr) {
          console.error('[runTenderAnalysis] OCR failed:', ocrErr)
        }
      }
      if (extracted.isLikelyScanned || !extracted.text.trim()) {
        await updateTenderStatus(tenderId, 'failed', 'scanned_pdf_unsupported')
        return { ok: false, error: 'PDF scanné non lisible (OCR indisponible) — fournir un PDF texte.' }
      }
      extractedText = extracted.text.trim()
      // Persiste le texte extrait (évite de ré-extraire à une relance).
      await supabase.from('tender_documents')
        .update({ extracted_text: extractedText, page_count: extracted.pageCount })
        .eq('tender_id', tenderId)
      await updateTenderStatus(tenderId, 'analyzing')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[runTenderAnalysis] extraction failed:', e)
      await updateTenderStatus(tenderId, 'failed', `extraction: ${msg}`)
      return { ok: false, error: `Extraction texte échouée : ${msg}` }
    }
  }

  // ÉTAPE 2 — ANALYSE. On résout l'org depuis le userId via le client ADMIN et on
  // la passe à analyzeTender → la bibliothèque est lue SANS cookies (l'analyse ne
  // dépend plus du scope requête, qui manquait en after() et cassait l'analyse).
  let orgId: string | null = null
  if (userId) {
    const { data: u } = await createAdminClient().from('users').select('organization_id').eq('id', userId).maybeSingle()
    orgId = (u as { organization_id: string | null } | null)?.organization_id ?? null
  }

  try {
    const result = await withTimeout(analyzeTender(extractedText, userId, orgId), ANALYZE_TIMEOUT_MS, 'Analyse IA')

    const knowledgeItems = await listKnowledgeItems({})
    const isMock = result.provider === 'mock'
    const validated = validateAnalysisSources(result.reading, {
      extractedText,
      knowledgeItems,
      skipPdfValidation: isMock,
    })

    await insertTenderAnalysis({
      tender_id: tenderId,
      provider: result.provider as 'mock' | 'gemini' | 'anthropic' | 'openai',
      model: result.model,
      prompt_versions: result.promptVersions,
      summary: result.reading.summary,
      constraints: validated.constraints,
      risks: validated.risks,
      checklist: validated.checklist,
      technical_memo: result.memo.technical_memo,
      library_snapshot: result.librarySnapshot,
      raw_response: null,
      document_sources: result.documentSources,
    })
    await updateTenderStatus(tenderId, 'ready', null, result.score.score)
    return { ok: true, score: result.score.score }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[runTenderAnalysis] failed:', e)
    try {
      await updateTenderStatus(tenderId, 'failed', msg)
    } catch (statusErr) {
      console.error('[runTenderAnalysis] could not mark failed:', statusErr)
    }
    return { ok: false, error: msg }
  }
}
