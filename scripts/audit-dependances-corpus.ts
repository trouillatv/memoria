/** Audit READ-ONLY — état réel des 3 systèmes de relations inter-sujets.
 *  Aucune écriture. Mesure la densité du corpus relationnel avant toute refonte.
 *
 *  3 tables :
 *   - subject_relation        (mig 145, « A BLOQUE B », subjects opérationnels, humain)
 *   - subject_thread_links    (mig 269, threads → canonical, auto cooccurrence + humain)
 *   - canonical_subject_links (mig 316, canonical natif + evidence, RELATION_CLAIM copilot)
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

function tally<T extends string>(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) { const k = String(r[key] ?? 'null'); out[k] = (out[k] ?? 0) + 1 }
  return out
}

async function main() {
  const line = '─'.repeat(72)

  // ── 1. subject_thread_links (système LIVE principal) ──────────────────────
  const { data: stl, count: stlCount } = await sb
    .from('subject_thread_links')
    .select('id, site_id, link_type, status, source, confidence, created_by, confirmed_by', { count: 'exact' })
  const stlRows = (stl ?? []) as Array<Record<string, unknown>>
  console.log(line)
  console.log(`subject_thread_links (mig 269) — TOTAL = ${stlCount}`)
  console.log('  par status :', tally(stlRows, 'status'))
  console.log('  par source :', tally(stlRows, 'source'))
  console.log('  par link_type :', tally(stlRows, 'link_type'))
  const stlConfirmed = stlRows.filter(r => r.status === 'confirmed')
  const stlSuggested = stlRows.filter(r => r.status === 'suggested')
  const stlRejected  = stlRows.filter(r => r.status === 'rejected')
  console.log(`  confirmed=${stlConfirmed.length} suggested=${stlSuggested.length} rejected=${stlRejected.length}`)
  console.log('  confirmed par source :', tally(stlConfirmed, 'source'))
  console.log(`  sites distincts touchés : ${new Set(stlRows.map(r => r.site_id)).size}`)

  // ── 2. canonical_subject_links (RELATION_CLAIM copilot + moteur script) ───
  const { data: csl, count: cslCount } = await sb
    .from('canonical_subject_links')
    .select('id, site_id, relation_type, status, confidence, created_by, confirmed_by, copilot_proposal_id, evidence_run_id', { count: 'exact' })
  const cslRows = (csl ?? []) as Array<Record<string, unknown>>
  console.log(line)
  console.log(`canonical_subject_links (mig 316) — TOTAL = ${cslCount}`)
  console.log('  par status :', tally(cslRows, 'status'))
  console.log('  par relation_type :', tally(cslRows, 'relation_type'))
  console.log(`  avec copilot_proposal_id (RELATION_CLAIM) : ${cslRows.filter(r => r.copilot_proposal_id).length}`)
  console.log(`  avec evidence_run_id (moteur cooccurrence) : ${cslRows.filter(r => r.evidence_run_id).length}`)
  console.log(`  sites distincts touchés : ${new Set(cslRows.map(r => r.site_id)).size}`)
  const { count: cslEvidence } = await sb.from('canonical_subject_link_evidence').select('id', { count: 'exact', head: true })
  console.log(`  canonical_subject_link_evidence rows : ${cslEvidence}`)

  // ── 3. subject_relation (BLOQUE humain, subjects opérationnels) ───────────
  const { data: sr, count: srCount } = await sb
    .from('subject_relation')
    .select('id, importance, created_by, from_subject_id, to_subject_id', { count: 'exact' })
  const srRows = (sr ?? []) as Array<Record<string, unknown>>
  console.log(line)
  console.log(`subject_relation (mig 145, BLOQUE) — TOTAL = ${srCount}`)
  console.log('  par importance :', tally(srRows, 'importance'))

  // ── 4. Focus sites témoins ────────────────────────────────────────────────
  console.log(line)
  const { data: sites } = await sb.from('sites').select('id, name').ilike('name', '%')
  const witnesses = (sites ?? []).filter((s: Record<string, unknown>) =>
    /bella|ocef|petro/i.test(String(s.name)))
  for (const w of witnesses as Array<{ id: string; name: string }>) {
    const stlW = stlRows.filter(r => r.site_id === w.id)
    const cslW = cslRows.filter(r => r.site_id === w.id)
    // subjects de ce site → subject_relation
    const { data: subjW } = await sb.from('subjects').select('id').eq('site_id', w.id)
    const subjIds = new Set((subjW ?? []).map((s: Record<string, unknown>) => s.id))
    const srW = srRows.filter(r => subjIds.has(r.from_subject_id) || subjIds.has(r.to_subject_id))
    const { count: csCount } = await sb.from('canonical_subject').select('id', { count: 'exact', head: true }).eq('site_id', w.id).eq('status', 'active')
    console.log(`${w.name} (${w.id.slice(0, 8)}) : ${csCount} canonical actifs`)
    console.log(`   subject_thread_links: ${stlW.length} (confirmed ${stlW.filter(r => r.status === 'confirmed').length} / suggested ${stlW.filter(r => r.status === 'suggested').length} / rejected ${stlW.filter(r => r.status === 'rejected').length})`)
    console.log(`   canonical_subject_links: ${cslW.length} (confirmed ${cslW.filter(r => r.status === 'confirmed').length} / suggested ${cslW.filter(r => r.status === 'suggested').length})`)
    console.log(`   subject_relation (BLOQUE): ${srW.length}`)
  }

  // ── 5. Verdict corpus ─────────────────────────────────────────────────────
  console.log(line)
  const liveGraphEdges = stlConfirmed.length + cslRows.filter(r => r.status === 'confirmed').length
  console.log(`ARÊTES AFFICHÉES (confirmed, tous systèmes canoniques) = ${liveGraphEdges}`)
  console.log(`  dont Dépendances tab (subject_thread_links confirmed) = ${stlConfirmed.length}`)
  console.log(`  dont Carte only (canonical_subject_links confirmed) = ${cslRows.filter(r => r.status === 'confirmed').length}`)
  console.log(`SUGGESTIONS EN ATTENTE (jamais affichées hors fiche) = ${stlSuggested.length}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
