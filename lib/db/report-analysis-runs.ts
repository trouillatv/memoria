// HISTORIQUE LÉGER des analyses (mig 142, P2b) — juste le DELTA par run, pas de
// snapshot. Répond à « qu'est-ce que l'audio complémentaire a apporté ? » en 5 s.
import { createAdminClient } from '@/lib/supabase/admin'

export interface AnalysisDelta {
  newActions: number
  newProposals: number
  newParticipants: number
  newRisks: number
  byType?: Record<string, number>
}

export interface AnalysisRun {
  id: string
  trigger: 'initial' | 'reanalysis'
  sourceCount: number | null
  delta: AnalysisDelta
  createdAt: string
}

export async function createAnalysisRun(input: {
  reportId: string
  trigger: 'initial' | 'reanalysis'
  sourceCount: number | null
  delta: AnalysisDelta
}): Promise<void> {
  const { error } = await createAdminClient().from('report_analysis_runs').insert({
    report_id: input.reportId,
    trigger: input.trigger,
    source_count: input.sourceCount,
    delta: input.delta,
  })
  if (error) throw new Error(error.message)
}

export async function listAnalysisRuns(reportId: string): Promise<AnalysisRun[]> {
  const { data } = await createAdminClient()
    .from('report_analysis_runs')
    .select('id, trigger, source_count, delta, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
  return (data ?? []).map((r) => ({
    id: r.id as string,
    trigger: (r.trigger as 'initial' | 'reanalysis') ?? 'reanalysis',
    sourceCount: (r.source_count as number | null) ?? null,
    delta: (r.delta as AnalysisDelta) ?? { newActions: 0, newProposals: 0, newParticipants: 0, newRisks: 0 },
    createdAt: r.created_at as string,
  }))
}
