import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  reconcileHistoricalCorpusForSite,
  getMaterializedRunIdsForSite,
} from '@/lib/db/canonical-subject-historical-corpus-reconcile'
import { decideReconcileLock, acquireReconcileLock } from '@/lib/db/canonical-subject-source-reconcile'
import { projectCanonicalSubjectSafely } from '@/lib/db/canonical-subject-project'
import { attachHistoricalReportEntitiesToCanonicalBusinessObjects } from '@/lib/db/canonical-business-object-attach'
import { runHistoricalMemoryBuildPipeline } from '@/lib/subjects/memory-build-pipeline'
import { resolveSiteDocumentCompletionsByProposal } from '@/lib/knowledge/document-completion-resolver'

export type HistoricalImportPostProcessingOutcome =
  | 'completed'
  | 'already_completed'
  | 'concurrent'
  | 'lock_lost'
  | 'failed'

export interface HistoricalImportPostProcessingParams {
  runId: string
  siteId: string
  siteReportId: string
  visitDate: string
}

async function getTouchedCanonicalSubjectIdsForRun(
  sb: ReturnType<typeof createAdminClient>,
  runId: string,
  siteId: string,
): Promise<string[]> {
  const { data: proposals } = await sb
    .from('document_extraction_proposal')
    .select('subject_thread_id')
    .eq('extraction_run_id', runId)
    .not('subject_thread_id', 'is', null)
  const threadIds = [...new Set((proposals ?? []).map((row) => row.subject_thread_id as string))]
  if (threadIds.length === 0) return []

  const { data: identities } = await sb
    .from('subject_thread_identity')
    .select('canonical_subject_id')
    .eq('site_id', siteId)
    .in('subject_thread_id', threadIds)
  return [...new Set((identities ?? []).map((row) => row.canonical_subject_id as string))]
}

/**
 * Post-traitement rejouable d'un import historique.
 *
 * La visite et ses objets métier existent déjà lorsque cette fonction démarre.
 * Elle ne crée donc jamais de visite, capture, action, réserve ou échéance.
 * Le verrou canonique est un bail avec TTL : un processus tué peut être repris.
 */
export async function runHistoricalImportPostProcessing(
  params: HistoricalImportPostProcessingParams,
): Promise<HistoricalImportPostProcessingOutcome> {
  const { runId, siteId, siteReportId, visitDate } = params
  const sb = createAdminClient()
  const { data: reportStatus } = await sb
    .from('site_reports')
    .select(
      'canonical_reconciled_at, canonical_reconcile_started_at, ' +
        'similarity_analysis_completed_at, similarity_analysis_error',
    )
    .eq('id', siteReportId)
    .maybeSingle()

  const typedStatus = reportStatus as {
    canonical_reconciled_at?: string | null
    canonical_reconcile_started_at?: string | null
    similarity_analysis_completed_at?: string | null
    similarity_analysis_error?: string | null
  } | null
  const decision = decideReconcileLock(typedStatus, Date.now())
  if (decision === 'concurrent') return 'concurrent'
  if (decision === 'done' && typedStatus?.similarity_analysis_completed_at && !typedStatus.similarity_analysis_error) {
    return 'already_completed'
  }

  let touchedCanonicalSubjectIds: string[] = []
  if (decision === 'acquire') {
    const now = new Date().toISOString()
    const priorStartedAt = typedStatus?.canonical_reconcile_started_at
    const locked = await acquireReconcileLock(sb, siteReportId, priorStartedAt, now)
    if (!locked) return 'lock_lost'

    try {
      const siteRunIds = await getMaterializedRunIdsForSite(sb, siteId)
      const corpusResult = await reconcileHistoricalCorpusForSite({ siteId, runIds: siteRunIds })
      if (!corpusResult.reachedFixedPoint) {
        throw new Error(
          `Convergence canonique non atteinte après ${corpusResult.passes} passages (site ${siteId})`,
        )
      }
      touchedCanonicalSubjectIds = corpusResult.touchedCanonicalSubjectIds

      await projectCanonicalSubjectSafely({
        siteId,
        scope: { kind: 'report', reportId: siteReportId },
      })

      await sb
        .from('site_reports')
        .update({
          canonical_reconciled_at: new Date().toISOString(),
          canonical_reconcile_error: null,
          canonical_reconcile_started_at: null,
        })
        .eq('id', siteReportId)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error('[historical-import-post-processing] canonicalization failed:', reason)
      await sb
        .from('site_reports')
        .update({ canonical_reconcile_error: reason, canonical_reconcile_started_at: null })
        .eq('id', siteReportId)
        .then(undefined, () => {})
      return 'failed'
    }
  } else {
    // Reprise après une canonicalisation déjà terminée mais un pipeline aval
    // interrompu : reconstruire la portée de similarité depuis les identités.
    touchedCanonicalSubjectIds = await getTouchedCanonicalSubjectIdsForRun(sb, runId, siteId)
  }

  await runHistoricalMemoryBuildPipeline({
    runId,
    siteId,
    siteReportId,
    visitDate,
    touchedCanonicalSubjectIds,
  })
  await attachHistoricalReportEntitiesToCanonicalBusinessObjects({ siteId, siteReportId })

  // Pont documentaire de complétion (P1-4B-WIRING) : UNITÉ DE PREUVE = document_extraction_proposal
  // (fait atomique), pas l'occurrence agrégée. Preuve → candidats CBO action du sujet → résolution
  // versionnée append-only proposal-level (idempotente par proof_proposal_id + policy + fingerprint).
  // Appelé APRÈS canonicalisation + attach (les subject_thread → canonical_subject → CBO existent).
  // Best-effort : ne produit ni signal ni changement d'état CBO ; un échec ici ne fait jamais échouer
  // l'import. Les résolutions occurrence-level antérieures restent lisibles (audit), non recalculées.
  try {
    await resolveSiteDocumentCompletionsByProposal(siteId)
  } catch (err) {
    console.error('[historical-import-post-processing] document completion resolver (proposal) failed:', err instanceof Error ? err.message : String(err))
  }

  return decision === 'done' ? 'already_completed' : 'completed'
}
