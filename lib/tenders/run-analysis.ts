// Exécution de l'analyse d'un AO — fonction PARTAGÉE (Vincent 2026-06-21).
//
// Avant : l'analyse tournait dans un `after()` post-réponse, que Vercel COUPE →
// l'AO restait coincé « analyzing » indéfiniment. Désormais elle tourne dans une
// vraie requête HTTP (route /analyze déclenchée par le client), qui garde la
// fonction serverless vivante jusqu'au bout. Cette fonction est le cœur partagé,
// appelée par la route ; bornée par un garde-temps ; idempotente (ne relance pas
// un AO déjà « ready »).

import { getTender, listTenderDocuments, updateTenderStatus, insertTenderAnalysis } from '@/lib/db/tenders'
import { analyzeTender } from '@/services/ai/orchestrator'
import { validateAnalysisSources } from '@/services/ai/source-validation'
import { listKnowledgeItems } from '@/lib/db/knowledge'
import { extractPdfText, extractWithGeminiOCR } from '@/services/pdf/extract'
import { buildTenderCorpus, type TenderPiece } from '@/lib/tenders/pieces'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbTenderDocument } from '@/types/db'

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
 * Extrait le texte d'UNE pièce et le persiste (une relance ne ré-extrait pas).
 * Rend `''` si la pièce est illisible (scan sans OCR) — au appelant de décider
 * si le dossier survit sans elle.
 */
async function extractPiece(doc: DbTenderDocument): Promise<string> {
  const supabase = createAdminClient()
  const { data: blob } = await supabase.storage.from('tender-documents').download(doc.storage_path)
  if (!blob) throw new Error(`PDF introuvable dans le stockage : ${doc.filename}`)
  const buffer = Buffer.from(await blob.arrayBuffer())

  let extracted = await withTimeout(extractPdfText(buffer), EXTRACT_TIMEOUT_MS, 'Extraction PDF')
  if (extracted.isLikelyScanned && process.env.GOOGLE_GENAI_API_KEY) {
    try {
      const ocr = await withTimeout(extractWithGeminiOCR(buffer), OCR_TIMEOUT_MS, 'OCR')
      if (ocr && ocr.trim()) extracted = { ...extracted, text: ocr, isLikelyScanned: false }
    } catch (ocrErr) {
      console.error('[runTenderAnalysis] OCR failed:', doc.filename, ocrErr)
    }
  }
  if (extracted.isLikelyScanned || !extracted.text.trim()) return ''

  const text = extracted.text.trim()
  // `.eq('id', …)` et NON `.eq('tender_id', …)` : sur un dossier à plusieurs
  // pièces, écrire par tender_id collerait le texte de la dernière pièce sur
  // TOUTES les autres — le CCTP deviendrait une copie du BPU.
  await supabase.from('tender_documents')
    .update({ extracted_text: text, page_count: extracted.pageCount })
    .eq('id', doc.id)
  return text
}

/**
 * Lance (ou reprend) l'analyse d'un AO et écrit le résultat + le statut.
 * Idempotent : si l'AO est déjà « ready », on ne relance pas.
 */
export async function runTenderAnalysis(tenderId: string, userId: string | null): Promise<RunAnalysisResult> {
  const tender = await getTender(tenderId)
  if (!tender) return { ok: false, error: 'AO introuvable' }
  if (tender.status === 'ready') return { ok: true, score: tender.opportunity_score ?? null, alreadyDone: true }

  // Le dossier, PAS le dernier document déposé : un AO est une bibliothèque
  // (RC, CCAP, CCTP, DPGF, BPU, plans). N'en lire qu'une pièce produisait une
  // analyse confiante et fausse.
  const docs = await listTenderDocuments(tenderId)
  if (docs.length === 0) {
    await updateTenderStatus(tenderId, 'failed', 'no document')
    return { ok: false, error: 'Aucun document attaché' }
  }

  // ÉTAPE 1 — EXTRACTION, PIÈCE PAR PIÈCE (hors du formulaire d'upload, où
  // pdf-parse bloquait le thread). OCR de secours si la pièce est scannée.
  //
  // Une pièce illisible ne condamne PAS le dossier : un plan scanné ne doit pas
  // empêcher de lire le CCTP. On n'échoue que si AUCUNE pièce n'est lisible.
  // Les pièces non lues gardent `extracted_text = null` — l'écran le montre,
  // rien n'est masqué.
  const pieces: TenderPiece[] = []
  const unreadable: string[] = []

  try {
    await updateTenderStatus(tenderId, 'extracting')
    for (const doc of docs) {
      const existing = (doc.extracted_text ?? '').trim()
      if (existing) {
        pieces.push({ kind: doc.kind, filename: doc.filename, text: existing })
        continue
      }
      const text = await extractPiece(doc)
      if (text) pieces.push({ kind: doc.kind, filename: doc.filename, text })
      else unreadable.push(doc.filename)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[runTenderAnalysis] extraction failed:', e)
    await updateTenderStatus(tenderId, 'failed', `extraction: ${msg}`)
    return { ok: false, error: `Extraction texte échouée : ${msg}` }
  }

  if (pieces.length === 0) {
    await updateTenderStatus(tenderId, 'failed', 'scanned_pdf_unsupported')
    return { ok: false, error: 'Aucune pièce lisible (PDF scannés ?) — fournir des PDF texte.' }
  }
  if (unreadable.length > 0) {
    console.warn(`[runTenderAnalysis] ${tenderId} — pièces non lues : ${unreadable.join(', ')}`)
  }

  // Chaque pièce reçoit sa part du budget de lecture : sans ça le RC mangerait
  // les 30 000 caractères de l'agent et le CCTP serait coupé.
  const extractedText = buildTenderCorpus(pieces)
  await updateTenderStatus(tenderId, 'analyzing')

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

    const knowledgeItems = await listKnowledgeItems({}, { orgId }) // sans cookies
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
