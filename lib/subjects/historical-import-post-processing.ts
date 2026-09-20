import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  reconcileHistoricalCorpusForSite,
  getMaterializedRunIdsForSite,
} from '@/lib/db/canonical-subject-historical-corpus-reconcile'
import { getProposalMaterializationReport } from '@/lib/db/document-extractions'
import { decideReconcileLock, acquireReconcileLock } from '@/lib/db/canonical-subject-source-reconcile'
import { projectCanonicalSubjectSafely } from '@/lib/db/canonical-subject-project'
import { ensureHistoricalPdfOccurrences } from '@/lib/db/canonical-subject-historical-occurrence'
import { attachHistoricalReportEntitiesToCanonicalBusinessObjects } from '@/lib/db/canonical-business-object-attach'
import { reconcileActionsByCanonicalBusinessObjectForReport } from '@/lib/db/action-cbo-reconciliation'
import { runHistoricalMemoryBuildPipeline } from '@/lib/subjects/memory-build-pipeline'
import { resolveSiteDocumentCompletionsByProposal } from '@/lib/knowledge/document-completion-resolver'
import { runTrackedPointLiveWriterForHistoricalRun } from '@/lib/db/tracked-point-live-writer-historical-adapter'
import { isSourceDocumentDeleted } from '@/lib/documents/historical-source-eligibility'
import { resyncOrphanedTrackedPointsForSite } from '@/lib/db/tracked-point-subject-resync'

export type HistoricalImportPostProcessingOutcome =
  | 'completed'
  | 'already_completed'
  | 'concurrent'
  | 'lock_lost'
  | 'failed'
  | 'source_deleted'

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
 * Phase 3 (programme Point de suivi) — correctif de la fenêtre d'orphelinage
 * temporelle (P0-1E Section F, Correctif 2). `reconcileHistoricalCorpusForSite`
 * balaie TOUS les runs du chantier à chaque appel : un thread appartenant à un
 * rapport déjà matérialisé (dont ensureHistoricalPdfOccurrences a déjà tourné,
 * scopé à son seul run) peut recevoir son identité canonique tardivement, lors
 * du traitement d'un rapport ultérieur. Sans ce rattrapage ciblé, son occurrence
 * n'est plus jamais posée (étalon `80105e6d`). Best-effort, additif, idempotent
 * (même index cso_historical_pdf_uniq) : ne crée ni run, ni site_report, ne
 * rejoue jamais materialize_historical_visit, ne touche ni actions, ni
 * décisions, ni échéances.
 */
async function catchUpOrphanedHistoricalOccurrences(
  sb: ReturnType<typeof createAdminClient>,
  siteId: string,
  orphanedRunIds: string[],
): Promise<void> {
  if (orphanedRunIds.length === 0) return

  const { data: reports } = await sb
    .from('site_reports')
    .select('id, extraction_run_id, started_at, source_document_id')
    .eq('site_id', siteId)
    .in('extraction_run_id', orphanedRunIds)

  const typedReports = (reports ?? []) as Array<{
    id: string
    extraction_run_id: string | null
    started_at: string | null
    source_document_id: string | null
  }>

  // Un rapport historique (origin=import) n'a jamais started_at renseigné — la date
  // de visite vient du document source (mêmes règles que review-actions.ts pour le
  // rapport courant : effective_date, jamais la date du PV lui-même).
  const docIds = [...new Set(typedReports.map((r) => r.source_document_id).filter((id): id is string => !!id))]
  const docEffectiveDate = new Map<string, string | null>()
  if (docIds.length > 0) {
    const { data: docs } = await sb.from('documents').select('id, effective_date').in('id', docIds)
    for (const d of (docs ?? []) as Array<{ id: string; effective_date: string | null }>) {
      docEffectiveDate.set(d.id, d.effective_date)
    }
  }

  for (const report of typedReports) {
    if (!report.extraction_run_id) continue
    const visitDate = report.started_at ?? (report.source_document_id ? docEffectiveDate.get(report.source_document_id) : null)
    if (!visitDate) continue
    try {
      await ensureHistoricalPdfOccurrences({
        runId: report.extraction_run_id,
        siteId,
        siteReportId: report.id,
        visitDate: visitDate.slice(0, 10),
      })
    } catch (err) {
      console.error(
        '[historical-import-post-processing] catch-up occurrences failed:',
        report.id,
        err instanceof Error ? err.message : String(err),
      )
    }
  }
}

/**
 * Axe B (P0 — resync Point → Sujet après réconciliation tardive) — un
 * tracked_point.canonical_subject_id n'est écrit qu'à la création du Point
 * (migration 401) ; si l'identité canonique de son thread est résolue APRÈS
 * coup (import ultérieur, rattrapage historique), le Point reste Sans Sujet
 * indéfiniment sans ce correctif. Best-effort, additif, idempotent (scope
 * canonical_subject_id IS NULL) : ne devine jamais une identité ambiguë ou
 * non résolue, ne touche jamais un Point sous override humain actif (RPC
 * fn_resync_orphaned_tracked_points, migration 421).
 */
async function resyncOrphanedTrackedPoints(siteId: string): Promise<void> {
  try {
    const rows = await resyncOrphanedTrackedPointsForSite(siteId)
    const resyncedCount = rows.filter((r) => r.verdict === 'resynced').length
    if (resyncedCount > 0) {
      console.log(
        `[historical-import-post-processing] resync orphelins Point→Sujet: site=${siteId} ` +
          `rattachés=${resyncedCount}/${rows.length}`,
      )
    }
  } catch (err) {
    console.error(
      '[historical-import-post-processing] resync orphelins Point→Sujet failed:',
      siteId,
      err instanceof Error ? err.message : String(err),
    )
  }
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
      'source_document_id, canonical_reconciled_at, canonical_reconcile_started_at, canonical_reconcile_error, ' +
        'similarity_analysis_completed_at, similarity_analysis_error, ' +
        'action_cbo_reconciled_at, action_cbo_reconcile_error, ' +
        'tracked_point_live_writer_completed_at, tracked_point_live_writer_error, ' +
        'document_completion_resolved_at, document_completion_error',
    )
    .eq('id', siteReportId)
    .maybeSingle()

  const typedStatus = reportStatus as {
    source_document_id?: string | null
    canonical_reconciled_at?: string | null
    canonical_reconcile_started_at?: string | null
    canonical_reconcile_error?: string | null
    similarity_analysis_completed_at?: string | null
    similarity_analysis_error?: string | null
    action_cbo_reconciled_at?: string | null
    action_cbo_reconcile_error?: string | null
    tracked_point_live_writer_completed_at?: string | null
    tracked_point_live_writer_error?: string | null
    document_completion_resolved_at?: string | null
    document_completion_error?: string | null
  } | null

  // P0 — DELETED HISTORICAL SOURCE (2026-09-17) : porte d'entrée unique du
  // pipeline d'écriture (occurrences, CBO, actions-CBO, Live Writer, ponts de
  // complétion). Un document supprimé après import ne doit plus jamais
  // déclencher aucune de ces écritures — court-circuit avant tout verrou/lecture.
  if (await isSourceDocumentDeleted(sb, typedStatus?.source_document_id)) {
    return 'source_deleted'
  }

  // P0 (2026-09-18) — reprise historique incomplète : le sweep/retry ne doit
  // jamais construire Canonical/CBO/Live Writer au-dessus d'un site_report dont
  // les propositions acceptées n'ont pas été matérialisées en objets métier. Ce
  // post-processing ne rejoue volontairement pas la matérialisation principale
  // (geste séparé, non idempotent au bon niveau ici) : il bloque et rend l'état
  // observable pour un dry-run/rattrapage explicite.
  const materializationReport = await getProposalMaterializationReport(runId)
  const acceptedNotRejected =
    materializationReport.autoAccepted -
    materializationReport.rejectedByGuard -
    materializationReport.exemptFromMaterialization
  if (acceptedNotRejected > 0 && materializationReport.materialized < acceptedNotRejected) {
    const reason =
      `Matérialisation historique incomplète: ${materializationReport.materialized}/` +
      `${acceptedNotRejected} propositions acceptées matérialisées (run ${runId})`
    await sb
      .from('site_reports')
      .update({ canonical_reconcile_error: reason, canonical_reconcile_started_at: null })
      .eq('id', siteReportId)
      .then(undefined, () => {})
    return 'failed'
  }

  // P0 (2026-09-21) — decideReconcileLock ne fournit pas de hash de contenu sur
  // cette voie historique (cf. sa doc : comportement mig 318 strict). Il traite
  // donc 'done' comme définitif dès que canonical_reconciled_at est renseigné,
  // sans jamais regarder canonical_reconcile_error. Or ce champ peut avoir été
  // écrit par une tentative POSTÉRIEURE à ce succès (garde de complétude ou
  // exception de réconciliation, cf. plus haut/plus bas) sans toucher
  // canonical_reconciled_at : l'erreur reste alors affichée indéfiniment même
  // après correction de sa cause, car la branche 'acquire' — seule à l'effacer —
  // n'est jamais reprise. Une erreur résiduelle invalide donc 'done' : on force
  // une nouvelle tentative, qui l'efface (succès) ou la remplace par l'état réel
  // (échec persistant), jamais un silence stale.
  let decision = decideReconcileLock(typedStatus, Date.now())
  if (decision === 'done' && typedStatus?.canonical_reconcile_error) {
    decision = 'acquire'
  }
  if (decision === 'concurrent') return 'concurrent'
  if (
    decision === 'done' &&
    typedStatus?.similarity_analysis_completed_at &&
    !typedStatus.similarity_analysis_error &&
    typedStatus.action_cbo_reconciled_at &&
    !typedStatus.action_cbo_reconcile_error &&
    typedStatus.tracked_point_live_writer_completed_at &&
    !typedStatus.tracked_point_live_writer_error &&
    typedStatus.document_completion_resolved_at &&
    !typedStatus.document_completion_error
  ) {
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

      const orphanedRunIds = corpusResult.runIdsWithNewIdentity.filter((id) => id !== runId)
      await catchUpOrphanedHistoricalOccurrences(sb, siteId, orphanedRunIds)
      await resyncOrphanedTrackedPoints(siteId)

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

  // P0-B / P0-B.1 (stabilisation post-2-PV, arbitrage Vincent 2026-09-17) :
  // réconciliation des Actions dupliquées par identité CBO, une fois le
  // rattachement ci-dessus posé. Point 6 de la revue : cette étape protège un
  // invariant fonctionnel (pas de doublon d'obligation active) — elle n'est
  // plus un best-effort qui avale son erreur. Un échec persiste la raison
  // (action_cbo_reconcile_error, mig 413) et fait échouer le post-traitement :
  // le signal « mémoire à jour » ne doit jamais être renvoyé alors que cette
  // étape est inachevée. Rejouable : une relance recalcule et retente cette
  // étape (idempotent côté RPC), sans verrou dédié.
  try {
    const reconcileResult = await reconcileActionsByCanonicalBusinessObjectForReport({ siteReportId })
    if (reconcileResult.actionsSuperseded > 0 || reconcileResult.groupsBlockedDoneDurable > 0) {
      console.log(
        `[historical-import-post-processing] réconciliation CBO actions: site=${siteId} report=${siteReportId} ` +
          `groupes=${reconcileResult.groupsReconciled} actions_superseded=${reconcileResult.actionsSuperseded} ` +
          `groupes_bloques_done=${reconcileResult.groupsBlockedDoneDurable}`,
      )
    }
    await sb
      .from('site_reports')
      .update({ action_cbo_reconciled_at: new Date().toISOString(), action_cbo_reconcile_error: null })
      .eq('id', siteReportId)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(
      `[historical-import-post-processing] réconciliation CBO actions failed: site=${siteId} report=${siteReportId}`,
      reason,
    )
    await sb
      .from('site_reports')
      .update({ action_cbo_reconcile_error: reason })
      .eq('id', siteReportId)
      .then(undefined, () => {})
    return 'failed'
  }

  // P6 Live Writer (mandat Vincent, rollout global, P0-2B : comportement standard sans gate).
  // Best-effort, même doctrine que le pont documentaire ci-dessous : un échec ici ne fait
  // jamais échouer l'import historique. Log une ligne par run exécuté (site/verdicts/refusals)
  // pour le suivi du rollout (taux AUTO_LINKED/AUTO_CREATED, volume NEEDS_HUMAN, spikes par site).
  try {
    const liveWriterResult = await runTrackedPointLiveWriterForHistoricalRun({ runId, siteId })
    if (liveWriterResult) {
      console.log(
        `[tracked-point-live-writer] site=${siteId} run=${runId} units=${liveWriterResult.unitsProcessed} ` +
          `verdicts=${JSON.stringify(liveWriterResult.verdictCounts)} refusals=${liveWriterResult.refusals}`,
      )
    }
    await sb
      .from('site_reports')
      .update({
        tracked_point_live_writer_completed_at: new Date().toISOString(),
        tracked_point_live_writer_error: null,
      })
      .eq('id', siteReportId)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(
      `[historical-import-post-processing] tracked point live writer failed: site=${siteId} run=${runId}`,
      reason,
    )
    await sb
      .from('site_reports')
      .update({ tracked_point_live_writer_error: reason })
      .eq('id', siteReportId)
      .then(undefined, () => {})
  }

  // Pont documentaire de complétion (P1-4B-WIRING) : UNITÉ DE PREUVE = document_extraction_proposal
  // (fait atomique), pas l'occurrence agrégée. Preuve → candidats CBO action du sujet → résolution
  // versionnée append-only proposal-level (idempotente par proof_proposal_id + policy + fingerprint).
  // Appelé APRÈS canonicalisation + attach (les subject_thread → canonical_subject → CBO existent).
  // Best-effort : ne produit ni signal ni changement d'état CBO ; un échec ici ne fait jamais échouer
  // l'import. Les résolutions occurrence-level antérieures restent lisibles (audit), non recalculées.
  try {
    await resolveSiteDocumentCompletionsByProposal(siteId)
    await sb
      .from('site_reports')
      .update({
        document_completion_resolved_at: new Date().toISOString(),
        document_completion_error: null,
      })
      .eq('id', siteReportId)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[historical-import-post-processing] document completion resolver (proposal) failed:', reason)
    await sb
      .from('site_reports')
      .update({ document_completion_error: reason })
      .eq('id', siteReportId)
      .then(undefined, () => {})
  }

  return decision === 'done' ? 'already_completed' : 'completed'
}
