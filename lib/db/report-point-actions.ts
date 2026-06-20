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

/** Écrit les responsables d'un point. `organisations` (mig 135) prépare le modèle
 *  « le vrai responsable = l'organisme » (ETV→BatiSud) : stocké à côté des rôles,
 *  même si l'UI n'envoie encore que les rôles. Quand on branchera la sélection
 *  d'organisme, aucune migration ni rupture — juste l'UI à compléter. */
export async function setReportPointActions(
  reportId: string,
  pointSource: string,
  codes: string[],
  organisations: string[] = [],
): Promise<void> {
  const clean = codes.filter((c): c is ActionCode => (ACTION_CODES as readonly string[]).includes(c))
  const orgs = organisations.map((o) => o.trim()).filter(Boolean)
  const { error } = await createAdminClient()
    .from('report_point_actions')
    .upsert(
      { report_id: reportId, point_source: pointSource, codes: clean, organisations: orgs, updated_at: new Date().toISOString() },
      { onConflict: 'report_id,point_source' },
    )
  if (error) throw new Error(error.message)
}
