// CAPTURE PASSIVE des corrections d'Émeline (mig 139) — instrumentation, PAS d'IA.
// « Un système d'observation de l'apprentissage » : chaque correction humaine est un
// exemple d'entraînement gratuit, non reconstituable une fois le chantier terminé.
//
// RÈGLE ABSOLUE : best-effort. Logger une correction ne doit JAMAIS faire échouer la
// correction elle-même → tout est avalé dans un try/catch.
import { createAdminClient } from '@/lib/supabase/admin'

export interface CorrectionEvent {
  entity: string                       // 'participant' | 'casting' | 'decision' | 'action' | 'point_action' …
  field?: string | null                // 'organisme' | 'presence' | 'echeance' …
  category: string                     // bucket de stats : 'organisation' | 'participant' | 'presence' | 'decision' …
  op: 'added' | 'edited' | 'removed'
  before?: string | null
  after?: string | null
}

export async function recordCorrections(input: {
  reportId: string | null
  siteId?: string | null
  actorId?: string | null
  events: CorrectionEvent[]
}): Promise<void> {
  try {
    if (!input.events.length) return
    const sb = createAdminClient()
    let siteId = input.siteId ?? null
    if (!siteId && input.reportId) {
      const { data } = await sb.from('site_reports').select('site_id').eq('id', input.reportId).maybeSingle()
      siteId = (data as { site_id: string | null } | null)?.site_id ?? null
    }
    const rows = input.events.map((e) => ({
      report_id: input.reportId,
      site_id: siteId,
      entity: e.entity,
      field: e.field ?? null,
      category: e.category,
      op: e.op,
      before_val: e.before ?? null,
      after_val: e.after ?? null,
      actor_id: input.actorId ?? null,
    }))
    await sb.from('memory_correction_events').insert(rows)
  } catch (e) {
    // Jamais bloquant : la correction métier a déjà réussi, le log est un bonus.
    console.error('[recordCorrections] best-effort, ignoré :', e)
  }
}

export interface CorrectionStat { category: string; count: number; pct: number }

/** « Corrections les plus fréquentes » (28% organismes, 22% participants…) → où
 *  investir. Déterministe, sans IA. Optionnellement scopé à un site. */
export async function correctionStats(opts?: { siteId?: string }): Promise<{ total: number; byCategory: CorrectionStat[] }> {
  const sb = createAdminClient()
  let q = sb.from('memory_correction_events').select('category')
  if (opts?.siteId) q = q.eq('site_id', opts.siteId)
  const { data } = await q
  const rows = data ?? []
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.category as string, (counts.get(r.category as string) ?? 0) + 1)
  const total = rows.length
  const byCategory = [...counts.entries()]
    .map(([category, count]) => ({ category, count, pct: total ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count)
  return { total, byCategory }
}
