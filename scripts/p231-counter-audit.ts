/** #231 Phase 1 — audit READ-ONLY des compteurs Aperçu. Population réelle vs affichée vs destination.
 *  Mesure : (1) « N proposées » site-wide vs dernière visite (destination synthesisHref) ;
 *           (2) Attention : total items scorés vs cap 5 vs top-3 « N autres sujets » ;
 *           (3) Blocages ouverts (carte sans href). AUCUNE écriture. */
import { createClient } from '@supabase/supabase-js'
import { deriveCanonicalAttentionItems } from '../lib/knowledge/canonical-attention'
import { readLatestVisitSynthesis } from '../lib/knowledge/repository'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { data: sites } = await sb.from('sites').select('id, name').order('name')
  const rows = (sites ?? []) as Array<{ id: string; name: string }>

  console.log('\n════════ #231 — AUDIT COMPTEURS APERÇU (READ-ONLY) ════════\n')

  for (const s of rows) {
    // (1) « N proposées » — site_knowledge_proposals kind=action status=proposed (ce que compte l'Aperçu)
    const { data: props } = await sb
      .from('site_knowledge_proposals')
      .select('id, report_id')
      .eq('site_id', s.id).eq('kind', 'action').eq('status', 'proposed')
    const proposed = (props ?? []) as Array<{ id: string; report_id: string | null }>
    const proposedCount = proposed.length
    if (proposedCount === 0) continue // on ne s'intéresse qu'aux chantiers avec proposées

    const byReport = new Map<string | null, number>()
    for (const p of proposed) byReport.set(p.report_id, (byReport.get(p.report_id) ?? 0) + 1)
    const synth = await readLatestVisitSynthesis(s.id).catch(() => null)
    const lastReportId = synth?.reportId ?? null
    const inLastVisit = byReport.get(lastReportId) ?? 0
    const orphan = proposedCount - inLastVisit
    const distinctReports = byReport.size

    // (2) Attention — combien d'items scorés au total ? (on demande large pour voir le vrai total)
    const attnAll = await deriveCanonicalAttentionItems(s.id, { limit: 9999 }).catch(() => [])
    const attnShown = Math.min(3, attnAll.length)
    const attnRestCurrent = Math.max(0, Math.min(5, attnAll.length) - 3) // ce que « N autres sujets » affiche aujourd'hui (cap 5)
    const attnRestReal = Math.max(0, attnAll.length - 3)

    // (3) Blocages ouverts (carte sans href)
    const { data: bloc } = await sb.from('site_blocages').select('id, date_end').eq('site_id', s.id)
    const blocOpen = ((bloc ?? []) as Array<{ date_end: string | null }>).filter((b) => b.date_end === null).length

    console.log(`### ${s.name}  [${s.id.slice(0, 8)}]`)
    console.log(`  proposées(action) = ${proposedCount}  ·  dans dernière visite = ${inLastVisit}  ·  ORPHELINES (autres reports) = ${orphan}  ·  reports distincts = ${distinctReports}  ·  lastReport=${(lastReportId ?? 'null').slice(0, 8)}`)
    console.log(`  attention: total scorés = ${attnAll.length}  ·  top-3 affichés  ·  « N autres » AUJOURD'HUI = ${attnRestCurrent}  ·  RÉEL = ${attnRestReal}  ${attnRestCurrent !== attnRestReal ? '⚠️ SOUS-COMPTE' : ''}`)
    console.log(`  blocages ouverts (carte sans href) = ${blocOpen}`)
    console.log('')
  }

  console.log('════════ verdicts ════════')
  console.log('- proposées : si ORPHELINES>0 sur un chantier réel → la dernière visite ne montre pas toute la population → gap destination.')
  console.log('- attention : si « N autres » AUJOURD\'HUI < RÉEL → double troncature silencieuse (cap 5 puis top 3).')
}
main().catch((e) => { console.error(e); process.exit(1) })
