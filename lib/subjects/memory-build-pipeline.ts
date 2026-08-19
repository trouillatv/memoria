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
}
