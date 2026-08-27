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
import { SEMANTIC_FEED_AUTO_BUDGET, decideSemanticFeedMode } from './semantic-feed-candidates'
import { loadSimilarityContextSubjects, type SimilarityContextSubject } from './similarity-context'
import { runSimilarityAnalysisForSubjects } from './similarity-run'
import { buildSemanticFeedPlan, executeSemanticFeedPlan } from './semantic-feed-run'

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

    // P-UI-R2d — voie sémantique hybride, APRÈS la voie lexicale. Isolée dans son propre
    // try/catch : elle ne doit jamais faire échouer l'import ni le statut lexical.
    await runSemanticFeedHybrid(subjects, siteId, touchedSubjectIds, rejectedPairs)

    await markCompleted(summary.subjectCount)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[similarity-trigger] failed:', message)
    await markFailed(message)
  }
}

/**
 * P-UI-R2d — stratégie hybride de la voie sémantique :
 *   1. plan GRATUIT (aucun LLM) → compte les paires candidates non lexicales ;
 *   2. coût borné (≤ budget) → lancer automatiquement ;
 *   3. coût élevé (> budget) → NE RIEN lancer ; la « recherche approfondie » est proposée à
 *      l'humain (dérivée à l'affichage, cf. memory-build-result / SubjectLifelineGrid).
 * Jamais silencieusement désactivée : le cas différé est journalisé et exposé à l'UI.
 */
async function runSemanticFeedHybrid(
  subjects: SimilarityContextSubject[],
  siteId: string,
  touchedSubjectIds: string[],
  rejectedPairs: Set<string>,
): Promise<void> {
  try {
    const planResult = await buildSemanticFeedPlan(subjects, { siteId, touchedSubjectIds, rejectedPairs })
    const mode = decideSemanticFeedMode(planResult.plan.evaluatedPairCount, planResult.plan.capped)
    if (mode === 'auto') {
      const feed = await executeSemanticFeedPlan(subjects, planResult, { siteId, touchedSubjectIds, rejectedPairs, dryRun: false })
      console.log(
        `[semantic-feed] AUTO site=${siteId} pairs=${planResult.plan.evaluatedPairCount} ` +
        `persisted=${feed.persistedCount} errors=${feed.errorCount}`,
      )
    } else if (mode === 'defer') {
      console.log(
        `[semantic-feed] DEFER site=${siteId} pairs=${planResult.plan.evaluatedPairCount} > budget ${SEMANTIC_FEED_AUTO_BUDGET} ` +
        `— recherche approfondie proposée (aucun appel automatique)`,
      )
    }
  } catch (e) {
    // Non bloquant par conception : un échec sémantique ne casse jamais l'import.
    console.error('[semantic-feed] hybrid failed:', e instanceof Error ? e.message : String(e))
  }
}
