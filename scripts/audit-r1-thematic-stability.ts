/**
 * R-1 — audit READ-ONLY stabilité de thematic_category par canonical_subject. Aucun write.
 * Question : thematic_category varie-t-il entre propositions/occurrences d'un même sujet canonique ?
 * Si stable → dériver au niveau sujet (pas de duplication sur l'occurrence). Sinon HARD STOP.
 */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  // sujets ayant des occurrences historiques
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('canonical_subject_id, source_ref_id').eq('source_kind', 'historical_pdf').limit(100000)
  const csIds = [...new Set((occ ?? []).map((o) => o.canonical_subject_id))]
  const reportIds = [...new Set((occ ?? []).map((o) => o.source_ref_id))]
  const { data: reps } = await sb.from('site_reports').select('id, site_id, extraction_run_id').in('id', reportIds)
  const runIds = [...new Set((reps ?? []).map((r) => r.extraction_run_id).filter(Boolean))] as string[]

  // propositions de ces runs avec thematic_category + thread
  const props: { thematic_category: string | null; subject_thread_id: string | null }[] = []
  for (let i = 0; i < runIds.length; i += 50) {
    const { data } = await sb.from('document_extraction_proposal').select('thematic_category, subject_thread_id')
      .in('extraction_run_id', runIds.slice(i, i + 50)).not('subject_thread_id', 'is', null)
    props.push(...(data ?? []))
  }
  const threadIds = [...new Set(props.map((p) => p.subject_thread_id))] as string[]
  const t2c = new Map<string, string>()
  for (let i = 0; i < threadIds.length; i += 200) {
    const { data } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').in('subject_thread_id', threadIds.slice(i, i + 200))
    for (const s of data ?? []) t2c.set(s.subject_thread_id, s.canonical_subject_id)
  }

  // catégories distinctes par sujet (non-null)
  const byCs = new Map<string, Map<string, number>>()
  for (const p of props) {
    const cs = t2c.get(p.subject_thread_id!); if (!cs || !csIds.includes(cs)) continue
    const cat = (p.thematic_category ?? '').trim(); if (!cat) continue
    if (!byCs.has(cs)) byCs.set(cs, new Map())
    const m = byCs.get(cs)!; m.set(cat, (m.get(cat) ?? 0) + 1)
  }

  let stable = 0, multi = 0, noneCat = 0
  const examples: string[] = []
  for (const cs of csIds) {
    const m = byCs.get(cs)
    if (!m || m.size === 0) { noneCat++; continue }
    if (m.size === 1) stable++
    else { multi++; if (examples.length < 25) examples.push(`${cs.slice(0, 8)} : ${[...m.entries()].map(([c, n]) => `${c}(${n})`).join(', ')}`) }
  }

  // labels des sujets multi (pour juger légitime vs artefact)
  const multiCs = [...byCs.entries()].filter(([, m]) => m.size > 1).map(([cs]) => cs)
  const csLabel = new Map<string, string>()
  for (let i = 0; i < multiCs.length; i += 200) {
    const { data } = await sb.from('canonical_subject').select('id, label').in('id', multiCs.slice(i, i + 200))
    for (const c of data ?? []) csLabel.set(c.id, c.label)
  }

  console.log('=== R-1 stabilité thematic_category par canonical_subject ===')
  console.log(`Sujets historiques : ${csIds.length}`)
  console.log(`  1 seule catégorie (stable)     : ${stable}`)
  console.log(`  plusieurs catégories (instable): ${multi}`)
  console.log(`  aucune catégorie               : ${noneCat}`)
  console.log(`\nExemples de sujets multi-catégories :`)
  for (const e of examples) {
    const cs = e.slice(0, 8)
    const full = [...csLabel.entries()].find(([id]) => id.startsWith(cs))
    console.log(`  ${e}${full ? `  « ${full[1].slice(0, 40)} »` : ''}`)
  }
  console.log(`\nVERDICT : ${multi === 0 ? '✅ stable par sujet → dériver au niveau sujet, ne pas dupliquer' : `⚠️ ${multi} sujets multi-catégories → juger légitimité (HARD STOP si valeur métier propre au fait)`}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
