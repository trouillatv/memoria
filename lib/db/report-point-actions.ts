// Colonne ACTION des points examinés (mig 132) : codes responsables BECIB par point,
// stockés en MÉMOIRE (clé = source du point). Réutilisés CR suivant / recherche / relances.
import { createAdminClient } from '@/lib/supabase/admin'
import { ACTION_CODES, type ActionCode } from './action-codes'

export { ACTION_CODES, type ActionCode }

/** Map source de point → codes responsables. */
export async function listReportPointActions(reportId: string): Promise<Map<string, string[]>> {
  const { data } = await createAdminClient()
    .from('report_point_actions')
    .select('point_source, codes')
    .eq('report_id', reportId)
  const map = new Map<string, string[]>()
  for (const r of data ?? []) map.set(r.point_source as string, (r.codes as string[]) ?? [])
  return map
}

export async function setReportPointActions(reportId: string, pointSource: string, codes: string[]): Promise<void> {
  const clean = codes.filter((c): c is ActionCode => (ACTION_CODES as readonly string[]).includes(c))
  const { error } = await createAdminClient()
    .from('report_point_actions')
    .upsert(
      { report_id: reportId, point_source: pointSource, codes: clean, updated_at: new Date().toISOString() },
      { onConflict: 'report_id,point_source' },
    )
  if (error) throw new Error(error.message)
}
