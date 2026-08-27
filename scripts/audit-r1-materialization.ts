/**
 * R-1 — audit READ-ONLY du lien matérialisations pour le refactor (relation, pas attribut).
 * Question Vincent : comment (sujet, run) reconstruit le lien aujourd'hui, et plusieurs objets
 * peuvent-ils correspondre à une même occurrence (sujet, report, state_key) ?
 */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  // occurrences historiques : (cs, report)
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('canonical_subject_id, source_ref_id, state_key').eq('source_kind', 'historical_pdf').limit(100000)
  // report → run
  const reportIds = [...new Set((occ ?? []).map((o) => o.source_ref_id))]
  const { data: reps } = await sb.from('site_reports').select('id, extraction_run_id').in('id', reportIds)
  const report2run = new Map((reps ?? []).map((r) => [r.id, r.extraction_run_id]))

  // matérialisations par proposition, avec run + thread → cs
  const runIds = [...new Set([...report2run.values()].filter(Boolean))] as string[]
  const { data: props } = await sb.from('document_extraction_proposal').select('id, extraction_run_id, subject_thread_id').in('extraction_run_id', runIds).not('subject_thread_id', 'is', null)
  const propRun = new Map((props ?? []).map((p) => [p.id, p.extraction_run_id]))
  const propThread = new Map((props ?? []).map((p) => [p.id, p.subject_thread_id]))
  const threadIds = [...new Set((props ?? []).map((p) => p.subject_thread_id))] as string[]
  const t2c = new Map<string, string>()
  for (let i = 0; i < threadIds.length; i += 200) {
    const { data } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').in('subject_thread_id', threadIds.slice(i, i + 200))
    for (const s of data ?? []) t2c.set(s.subject_thread_id, s.canonical_subject_id)
  }
  const propIds = [...propRun.keys()]
  const mats: { proposal_id: string; target_entity_type: string }[] = []
  for (let i = 0; i < propIds.length; i += 200) {
    const { data } = await sb.from('document_proposal_materialization').select('proposal_id, target_entity_type').in('proposal_id', propIds.slice(i, i + 200)).in('target_entity_type', ['site_action', 'site_decision', 'site_reserve', 'site_deadline'])
    mats.push(...(data ?? []))
  }

  // (cs, run) → nb matérialisations
  const byCsRun = new Map<string, number>()
  const byType = new Map<string, number>()
  for (const m of mats) {
    const cs = t2c.get(propThread.get(m.proposal_id)!); const run = propRun.get(m.proposal_id)
    if (!cs || !run) continue
    byCsRun.set(`${cs}::${run}`, (byCsRun.get(`${cs}::${run}`) ?? 0) + 1)
    byType.set(m.target_entity_type, (byType.get(m.target_entity_type) ?? 0) + 1)
  }
  const multi = [...byCsRun.values()].filter((n) => n > 1).length

  console.log('=== R-1 matérialisations — relation (sujet, run) ===')
  console.log(`Matérialisations totales (corpus historique) : ${mats.length}`)
  console.log(`Couples (sujet, run) avec matérialisation : ${byCsRun.size}`)
  console.log(`  dont couples avec PLUSIEURS objets (relation 1→N) : ${multi}`)
  console.log(`Par type : ${[...byType.entries()].map(([t, n]) => `${t}=${n}`).join(' ')}`)
  console.log(`\nConclusion : la matérialisation est une RELATION au niveau (sujet, run), pas un attribut`)
  console.log(`d'occurrence (${multi} couples portent plusieurs objets). Reconstruire via report→run + thread→cs,`)
  console.log(`comme aujourd'hui, sans champ id/texte bricolé sur l'occurrence.`)
}
main().catch((e) => { console.error(e); process.exit(1) })
