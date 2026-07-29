// Matérialisation atomique d'une visite historique importée (Sprint 4C.2).
// Appelle l'RPC PostgreSQL materialize_historical_visit() via admin client.
// Le post-traitement des knowledge_fact reste en TypeScript (hors transaction).

import { createAdminClient } from '@/lib/supabase/admin'

export async function materializeHistoricalVisit(input: {
  runId: string
  userId: string
  siteId: string
  visitDate: string
  visitTitle?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('materialize_historical_visit', {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_site_id: input.siteId,
    p_visit_date: input.visitDate,
    p_visit_title: input.visitTitle ?? null,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function getExistingMaterializedVisit(runId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('site_reports')
    .select('id')
    .eq('extraction_run_id', runId)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}
