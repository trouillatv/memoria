import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { getProposalMaterializationReport } from '@/lib/db/document-extractions'
import { isSourceDocumentDeleted } from '@/lib/documents/historical-source-eligibility'

export type HistoricalMemoryUpdateState = 'updating' | 'up_to_date' | 'interrupted'

export type HistoricalMemoryUpdateStepKey =
  | 'materialization'
  | 'canonical'
  | 'similarity'
  | 'action_cbo'
  | 'live_writer'
  | 'completion'

export interface HistoricalMemoryUpdateStep {
  key: HistoricalMemoryUpdateStepKey
  label: string
  status: 'done' | 'current' | 'waiting' | 'error'
}

export interface HistoricalMemoryUpdateStatus {
  state: HistoricalMemoryUpdateState
  subjectCount: number
  error: string | null
  steps: HistoricalMemoryUpdateStep[]
}

export interface HistoricalMemoryUpdateReportRow {
  source_document_id?: string | null
  canonical_reconciled_at?: string | null
  canonical_reconcile_error?: string | null
  canonical_reconcile_started_at?: string | null
  similarity_analysis_started_at?: string | null
  similarity_analysis_completed_at?: string | null
  similarity_analysis_error?: string | null
  similarity_analysis_subject_count?: number | null
  action_cbo_reconciled_at?: string | null
  action_cbo_reconcile_error?: string | null
  tracked_point_live_writer_completed_at?: string | null
  tracked_point_live_writer_error?: string | null
  document_completion_resolved_at?: string | null
  document_completion_error?: string | null
}

export interface HistoricalMemoryUpdateMaterialization {
  acceptedForMaterialization: number
  materialized: number
}

const STEP_LABELS: Record<HistoricalMemoryUpdateStepKey, string> = {
  materialization: 'PV matérialisé',
  canonical: 'Sujets et lignes de vie',
  similarity: 'Rapprochements',
  action_cbo: 'Objets métier',
  live_writer: 'Points de suivi',
  completion: 'Questions MemorIA',
}

const STEP_ORDER: HistoricalMemoryUpdateStepKey[] = [
  'materialization',
  'canonical',
  'similarity',
  'action_cbo',
  'live_writer',
  'completion',
]

function firstError(report: HistoricalMemoryUpdateReportRow, materialization: HistoricalMemoryUpdateMaterialization): string | null {
  if (materialization.acceptedForMaterialization > 0 && materialization.materialized < materialization.acceptedForMaterialization) {
    return `Matérialisation historique incomplète: ${materialization.materialized}/${materialization.acceptedForMaterialization} propositions acceptées matérialisées`
  }
  return (
    report.canonical_reconcile_error ??
    report.similarity_analysis_error ??
    report.action_cbo_reconcile_error ??
    report.tracked_point_live_writer_error ??
    report.document_completion_error ??
    null
  )
}

function stepDone(key: HistoricalMemoryUpdateStepKey, report: HistoricalMemoryUpdateReportRow, materialization: HistoricalMemoryUpdateMaterialization): boolean {
  switch (key) {
    case 'materialization':
      return materialization.materialized >= materialization.acceptedForMaterialization
    case 'canonical':
      return !!report.canonical_reconciled_at && !report.canonical_reconcile_error
    case 'similarity':
      return !!report.similarity_analysis_completed_at && !report.similarity_analysis_error
    case 'action_cbo':
      return !!report.action_cbo_reconciled_at && !report.action_cbo_reconcile_error
    case 'live_writer':
      return !!report.tracked_point_live_writer_completed_at && !report.tracked_point_live_writer_error
    case 'completion':
      return !!report.document_completion_resolved_at && !report.document_completion_error
  }
}

function stepHasError(key: HistoricalMemoryUpdateStepKey, report: HistoricalMemoryUpdateReportRow, materialization: HistoricalMemoryUpdateMaterialization): boolean {
  switch (key) {
    case 'materialization':
      return materialization.acceptedForMaterialization > 0 && materialization.materialized < materialization.acceptedForMaterialization
    case 'canonical':
      return !!report.canonical_reconcile_error
    case 'similarity':
      return !!report.similarity_analysis_error
    case 'action_cbo':
      return !!report.action_cbo_reconcile_error
    case 'live_writer':
      return !!report.tracked_point_live_writer_error
    case 'completion':
      return !!report.document_completion_error
  }
}

export function deriveHistoricalMemoryUpdateStatus(
  report: HistoricalMemoryUpdateReportRow,
  materialization: HistoricalMemoryUpdateMaterialization,
): HistoricalMemoryUpdateStatus {
  const error = firstError(report, materialization)
  const steps: HistoricalMemoryUpdateStep[] = []
  let currentAssigned = false

  for (const key of STEP_ORDER) {
    const status = stepHasError(key, report, materialization)
      ? 'error'
      : stepDone(key, report, materialization)
        ? 'done'
        : currentAssigned
          ? 'waiting'
          : 'current'
    if (status === 'current' || status === 'error') currentAssigned = true
    steps.push({ key, label: STEP_LABELS[key], status })
  }

  return {
    state: error ? 'interrupted' : steps.every((step) => step.status === 'done') ? 'up_to_date' : 'updating',
    subjectCount: report.similarity_analysis_subject_count ?? 0,
    error,
    steps,
  }
}

export async function loadHistoricalMemoryUpdateStatus(
  siteReportId: string,
  runId: string,
): Promise<HistoricalMemoryUpdateStatus | null> {
  const db = createAdminClient()
  const { data: report } = await db
    .from('site_reports')
    .select(
      'source_document_id, canonical_reconciled_at, canonical_reconcile_error, canonical_reconcile_started_at, ' +
        'similarity_analysis_started_at, similarity_analysis_completed_at, similarity_analysis_error, similarity_analysis_subject_count, ' +
        'action_cbo_reconciled_at, action_cbo_reconcile_error, tracked_point_live_writer_completed_at, ' +
        'tracked_point_live_writer_error, document_completion_resolved_at, document_completion_error',
    )
    .eq('id', siteReportId)
    .maybeSingle()

  const typedReport = report as HistoricalMemoryUpdateReportRow | null
  if (!typedReport) return null
  if (await isSourceDocumentDeleted(db, typedReport.source_document_id)) return null

  const materializationReport = await getProposalMaterializationReport(runId)
  const acceptedForMaterialization =
    materializationReport.autoAccepted -
    materializationReport.rejectedByGuard -
    materializationReport.exemptFromMaterialization
  return deriveHistoricalMemoryUpdateStatus(typedReport, {
    acceptedForMaterialization,
    materialized: materializationReport.materialized,
  })
}
