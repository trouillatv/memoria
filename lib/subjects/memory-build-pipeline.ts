import 'server-only'

// P1-A — Pipeline complet de construction de mémoire pour une visite historique
// (PV importé) : occurrences canoniques (P0-B2) puis analyse de similarité
// incrémentale (P1-A). Un seul chemin de code partagé entre le déclenchement
// initial (createHistoricalVisitAction) et le réessai manuel (retryMemoryBuildAction)
// — pour ne jamais faire diverger les deux appelants.
//
// Persiste le statut sur site_reports (mig 342) pour le widget "MemorIA construit
// la mémoire du chantier". Ne doit jamais bloquer ni faire échouer le flux
// appelant : toutes les erreurs sont capturées et journalisées ici.

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureHistoricalPdfOccurrences } from '@/lib/db/canonical-subject-historical-occurrence'
import { triggerIncrementalSimilarityAnalysis } from './similarity-trigger'

export interface HistoricalMemoryBuildParams {
  runId: string
  siteId: string
  siteReportId: string
  visitDate: string // YYYY-MM-DD
  touchedCanonicalSubjectIds: string[]
}

export async function runHistoricalMemoryBuildPipeline(
  params: HistoricalMemoryBuildParams,
): Promise<void> {
  const { runId, siteId, siteReportId, visitDate, touchedCanonicalSubjectIds } = params
  const supabase = createAdminClient()

  await supabase
    .from('site_reports')
    .update({ similarity_analysis_started_at: new Date().toISOString() })
    .eq('id', siteReportId)

  try {
    await ensureHistoricalPdfOccurrences({ runId, siteId, siteReportId, visitDate })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[memory-build-pipeline] historical occurrences failed:', message)
    await supabase
      .from('site_reports')
      .update({ similarity_analysis_error: message })
      .eq('id', siteReportId)
    return
  }

  await triggerIncrementalSimilarityAnalysis({
    siteId,
    touchedSubjectIds: touchedCanonicalSubjectIds,
    siteReportId,
  })

  // ── Relations inter-sujets suggérées (occurrence-first, terrain-first) ──────
  // SEUL point d'acquisition automatique des relations : APRÈS matérialisation des
  // occurrences (ensureHistoricalPdfOccurrences) et réconciliation d'identité. Le
  // legacy produceRelationsForRun (proposals → subject_thread_links) a été retiré.
  //
  // Écrit canonical_subject_links status='suggested' UNIQUEMENT : preuve obligatoire
  // (evidence_text), whitelist serveur (relates_to rejeté), acteurs exclus, idempotent
  // (paires existantes exclues + contrainte unique). Une relation suggérée n'est JAMAIS
  // une vérité confirmée — l'UI doit toujours distinguer « Détecté par MemorIA » de
  // « Confirmé ». Best-effort : ne bloque jamais le pipeline. Filtre incrémental sur
  // les sujets touchés par ce run (triggerVisitId = siteReportId).
  try {
    const { produceRelationsFromOccurrences } = await import('@/lib/ai/produce-relations-from-occurrences')
    const rel = await produceRelationsFromOccurrences({ siteId, admin: supabase, triggerVisitId: siteReportId })
    if (rel.written > 0 || rel.sameSubjectDetected > 0 || rel.relatesTo > 0) {
      console.log(
        `[relations/occ] report=${siteReportId.slice(0, 8)} eval=${rel.candidatesEvaluated}` +
        ` written=${rel.written} noRel=${rel.noRelation} relates_to_rejetés=${rel.relatesTo}` +
        ` same=${rel.sameSubjectDetected} directional=${rel.directional}`,
      )
    }
  } catch (err) {
    console.error('[memory-build-pipeline] relations (non-bloquant):', err instanceof Error ? err.message : String(err))
  }
}
