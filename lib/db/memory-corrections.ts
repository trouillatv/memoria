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
  // Enrichissements mig 140 (tous facultatifs) :
  sourceType?: 'ai' | 'human' | 'mixed' | 'unknown' // origine de l'objet corrigé
  aiConfidence?: number | null         // confiance initiale IA si connue (souvent null)
  timeToCorrectMs?: number | null      // temps passé (timing client) si fourni
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
    let crNumber: number | null = null
    if (input.reportId) {
      // site_id (si absent) + date du CR, en un seul accès, pour calculer le rang du CR.
      const { data: rep } = await sb.from('site_reports').select('site_id, created_at').eq('id', input.reportId).maybeSingle()
      const r = rep as { site_id: string | null; created_at: string } | null
      siteId = siteId ?? r?.site_id ?? null
      if (siteId && r?.created_at) {
        const { count } = await sb
          .from('site_reports')
          .select('id', { count: 'exact', head: true })
          .eq('site_id', siteId)
          .lte('created_at', r.created_at)
        crNumber = count ?? null
      }
    }
    const rows = input.events.map((e) => ({
      report_id: input.reportId,
      site_id: siteId,
      cr_number: crNumber,
      entity: e.entity,
      field: e.field ?? null,
      category: e.category,
      op: e.op,
      before_val: e.before ?? null,
      after_val: e.after ?? null,
      source_type: e.sourceType ?? 'unknown',
      ai_confidence: e.aiConfidence ?? null,
      time_to_correct_ms: e.timeToCorrectMs ?? null,
      actor_id: input.actorId ?? null,
    }))
    await sb.from('memory_correction_events').insert(rows)
  } catch (e) {
    // Jamais bloquant : la correction métier a déjà réussi, le log est un bonus.
    console.error('[recordCorrections] best-effort, ignoré :', e)
  }
}

export interface CorrectionStat { category: string; count: number; pct: number; avgMs: number | null }

/** « Corrections les plus fréquentes » (28% organismes…) + temps moyen par catégorie
 *  (« ce qui fait perdre du temps »). Déterministe, sans IA. Scopable à un site. */
export async function correctionStats(opts?: { siteId?: string }): Promise<{ total: number; byCategory: CorrectionStat[] }> {
  const sb = createAdminClient()
  let q = sb.from('memory_correction_events').select('category, time_to_correct_ms')
  if (opts?.siteId) q = q.eq('site_id', opts.siteId)
  const { data } = await q
  const rows = data ?? []
  const counts = new Map<string, number>()
  const timeSum = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    const cat = r.category as string
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
    const t = r.time_to_correct_ms as number | null
    if (typeof t === 'number') {
      const acc = timeSum.get(cat) ?? { sum: 0, n: 0 }
      timeSum.set(cat, { sum: acc.sum + t, n: acc.n + 1 })
    }
  }
  const total = rows.length
  const byCategory = [...counts.entries()]
    .map(([category, count]) => {
      const ts = timeSum.get(category)
      return { category, count, pct: total ? Math.round((count / total) * 100) : 0, avgMs: ts && ts.n ? Math.round(ts.sum / ts.n) : null }
    })
    .sort((a, b) => b.count - a.count)
  return { total, byCategory }
}
