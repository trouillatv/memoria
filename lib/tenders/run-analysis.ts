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
  if (!doc || !doc.extracted_text) {
    await updateTenderStatus(tenderId, 'failed', 'no extracted text')
    return { ok: false, error: 'Aucun texte extrait du PDF' }
  }

  try {
    const result = await withTimeout(analyzeTender(doc.extracted_text, userId), ANALYZE_TIMEOUT_MS, 'Analyse IA')

    const knowledgeItems = await listKnowledgeItems({})
    const isMock = result.provider === 'mock'
    const validated = validateAnalysisSources(result.reading, {
      extractedText: doc.extracted_text,
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
