import 'server-only'

// P1-A — Déclenchement automatique de l'analyse de similarité après une
// canonicalisation réussie (import PV historique). Remplace le déclenchement
// manuel (npx tsx scripts/analyze-subject-similarities.ts --apply).
//
// Doctrine (Vincent, 2026-08-19/20) :
// - scope incrémental strict : sujets touchés par le traitement en cours ×
//   sujets actifs du chantier — jamais un recalcul complet du graphe.
// - aucun événement fiable de "fin de lot d'import" n'existe dans le code
//   (chaque PV historique est traité indépendamment) → déclenchement par
//   canonicalisation individuelle, idempotent, plutôt qu'un pseudo-batch.
// - suggestions uniquement (upsertSuggestion) : jamais de fusion ni de
//   création de relation automatique.
// - ne doit jamais bloquer ni faire échouer le flux appelant : toutes les
//   erreurs sont capturées et journalisées ici.

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePairKey } from './similarity-candidates'
import { loadSimilarityContextSubjects } from './similarity-context'
import { runSimilarityAnalysisForSubjects } from './similarity-run'

export interface IncrementalSimilarityTriggerParams {
  siteId: string
  touchedSubjectIds: string[]
  /** Visite historique d'origine — si fournie, le statut du pipeline est persisté (mig 342, widget mémoire). */
  siteReportId?: string | null
}

export async function triggerIncrementalSimilarityAnalysis(
  params: IncrementalSimilarityTriggerParams,
): Promise<void> {
  const { siteId, touchedSubjectIds, siteReportId } = params
  const supabase = createAdminClient()

  const markStarted = async () => {
    if (!siteReportId) return
    await supabase
      .from('site_reports')
      .update({ similarity_analysis_started_at: new Date().toISOString() })
      .eq('id', siteReportId)
  }
  const markCompleted = async (subjectCount: number) => {
    if (!siteReportId) return
    await supabase
      .from('site_reports')
      .update({
        similarity_analysis_completed_at: new Date().toISOString(),
        similarity_analysis_subject_count: subjectCount,
        similarity_analysis_error: null,
      })
      .eq('id', siteReportId)
  }
  const markFailed = async (message: string) => {
    if (!siteReportId) return
    await supabase
      .from('site_reports')
      .update({ similarity_analysis_error: message })
      .eq('id', siteReportId)
  }

  if (touchedSubjectIds.length === 0) {
    await markStarted()
    await markCompleted(0)
    return
  }

  await markStarted()

  try {
    const subjects = await loadSimilarityContextSubjects(siteId)
    if (subjects.length < 2) { await markCompleted(subjects.length); return }

    const scopeSet = new Set(touchedSubjectIds)
    // Un sujet touché absent du contexte (hors périmètre métier, ou personne/entreprise)
    // ne bloque pas l'analyse des autres sujets touchés.
    if (![...subjects].some((s) => scopeSet.has(s.forCandidates.id))) { await markCompleted(subjects.length); return }

    const { data: rejected } = await supabase
      .from('canonical_subject_similarity_suggestion')
      .select('subject_a_id, subject_b_id')
      .eq('site_id', siteId)
      .eq('status', 'rejected')
    const rejectedPairs = new Set(
      (rejected ?? []).map((r) => normalizePairKey(r.subject_a_id, r.subject_b_id)),
    )

    const summary = await runSimilarityAnalysisForSubjects(subjects, {
      siteId,
      rejectedPairs,
      scopeSubjectIds: scopeSet,
      dryRun: false,
    })

    console.log(
      `[similarity-trigger] site=${siteId} touched=${touchedSubjectIds.length} ` +
      `candidates=${summary.scopedCandidateCount}/${summary.candidateCount} ` +
      `persisted=${summary.persistedCount} errors=${summary.errorCount}`,
    )
    await markCompleted(summary.subjectCount)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[similarity-trigger] failed:', message)
    await markFailed(message)
  }
}
