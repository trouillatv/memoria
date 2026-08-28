/** Audit READ-ONLY — conservation de la causalité dans le pipeline visite. AUCUNE écriture.
 *  Trace, pour chaque visite réelle : transcript brut → debrief (summary/rationale) →
 *  propositions (title/body) → occurrence(s) field_visit (label/note). À chaque étage,
 *  extrait les PHRASES contenant un marqueur relationnel (pour lecture humaine) et mesure
 *  le taux de conservation. Ne décide pas par mots-clés seuls : les phrases sont imprimées.
 */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const REL = /(d[ée]pend|n[ée]cessite|impossible (?:de |tant)|tant qu[e']|avant (?:de |la |le |d')|apr[eè]s (?:validation|la |le |l')|une fois que|conditionn[ée]|pr[ée]alable|bloqu|emp[êe]ch|permet(?:tra|tre|)? (?:de|le|la)|ne peut(?:vent)? pas|ne pourra|subordonn|en attente (?:de|d')|requiert|doit être (?:termin|fait|valid|fini)|en remplacement|remplac|suite à|d[ûu] à|grâce à|faute de|sous r[ée]serve)/i

function sentences(txt: string): string[] {
  return txt.split(/(?<=[.!?;\n])\s+/).map(s => s.trim()).filter(s => s.length > 8)
}
function relSentences(txt: string | null | undefined): string[] {
  if (!txt) return []
  return sentences(String(txt)).filter(s => REL.test(s))
}

async function auditSite(siteId: string, name: string) {
  const { data: occ } = await sb.from('canonical_subject_occurrence')
    .select('source_ref_id, label, note').eq('site_id', siteId).eq('source_kind', 'field_visit')
  const reportIds = [...new Set((occ ?? []).map((o: Record<string, unknown>) => o.source_ref_id as string))]
  if (reportIds.length === 0) return { name, reports: 0, s0: 0, s1: 0, s2: 0, s3: 0 }

  console.log('\n' + '═'.repeat(88) + `\n### ${name} — ${reportIds.length} visites field_visit\n` + '═'.repeat(88))
  let s0Total = 0, s1Total = 0, s2Total = 0, s3Total = 0

  for (const rid of reportIds) {
    const { data: rep } = await sb.from('site_reports')
      .select('transcript_raw, transcript_corrected, text_input, debrief_analysis, started_at, visit_motive').eq('id', rid).maybeSingle()
    const r = (rep ?? {}) as Record<string, unknown>
    const da = (r.debrief_analysis ?? {}) as Record<string, unknown>

    // Stage 0 : matière brute
    const raw = [r.transcript_corrected, r.transcript_raw, r.text_input].filter(Boolean).map(String).join('\n')
    // Stage 1 : debrief (summary + rationales + decisions)
    const debrief = [
      da.summary,
      ...((da.actions as Array<Record<string, unknown>> ?? []).map(a => `${a.title} ${a.rationale ?? ''}`)),
      ...((da.decisions as Array<Record<string, unknown>> ?? []).map(d => JSON.stringify(d))),
      ...((da.watchpoints as Array<Record<string, unknown>> ?? []).map(w => JSON.stringify(w))),
    ].filter(Boolean).map(String).join('\n')
    // Stage 2 : propositions
    const { data: props } = await sb.from('site_knowledge_proposals').select('kind, title, body').eq('report_id', rid)
    const proposals = (props ?? []).map((p: Record<string, unknown>) => `${p.title ?? ''} ${p.body ?? ''}`).join('\n')
    // Stage 3 : occurrences de CE report
    const occs = (occ ?? []).filter((o: Record<string, unknown>) => o.source_ref_id === rid)
    const occText = occs.map((o: Record<string, unknown>) => `${o.label ?? ''} ${o.note ?? ''}`).join('\n')

    const r0 = relSentences(raw), r1 = relSentences(debrief), r2 = relSentences(proposals), r3 = relSentences(occText)
    s0Total += r0.length; s1Total += r1.length; s2Total += r2.length; s3Total += r3.length

    if (r0.length || r1.length || r2.length) {
      console.log(`\n── visite ${rid.slice(0, 8)} (${String(r.started_at ?? '').slice(0, 10)}) — brut:${raw.length}c debrief:${debrief.length}c props:${(props ?? []).length} occ:${occs.length}`)
      const show = (tag: string, arr: string[]) => { if (arr.length) { console.log(`   [${tag}] ${arr.length} phrase(s) relationnelle(s):`); arr.slice(0, 4).forEach(s => console.log(`      • ${s.slice(0, 180)}`)) } }
      show('0-BRUT', r0); show('1-DEBRIEF', r1); show('2-PROPOSITIONS', r2); show('3-OCCURRENCE', r3)
      if (raw.length === 0) console.log('   ⚠ matière brute VIDE (transcript+text_input absents) — impossible de tracer la perte amont')
    }
  }
  console.log(`\n  TOTAL ${name} : brut=${s0Total} debrief=${s1Total} propositions=${s2Total} occurrence=${s3Total}`)
  return { name, reports: reportIds.length, s0: s0Total, s1: s1Total, s2: s2Total, s3: s3Total }
}

async function main() {
  const { data: sites } = await sb.from('sites').select('id, name')
  const withFv = new Set<string>()
  const { data: fv } = await sb.from('canonical_subject_occurrence').select('site_id').eq('source_kind', 'field_visit')
  for (const o of (fv ?? []) as Array<Record<string, unknown>>) withFv.add(o.site_id as string)

  const results = []
  for (const s of (sites ?? []) as Array<{ id: string; name: string }>) {
    if (withFv.has(s.id)) results.push(await auditSite(s.id, s.name))
  }

  console.log('\n\n' + '━'.repeat(88) + '\nCONSERVATION GLOBALE (phrases relationnelles par étage)\n' + '━'.repeat(88))
  let a = 0, b = 0, c = 0, d = 0
  for (const r of results.sort((x, y) => y.s0 - x.s0)) {
    a += r.s0; b += r.s1; c += r.s2; d += r.s3
    console.log(`${r.name.padEnd(34)} brut=${r.s0}  debrief=${r.s1}  propositions=${r.s2}  occurrence=${r.s3}`)
  }
  console.log('─'.repeat(60))
  console.log(`TOTAL  brut=${a}  debrief=${b}  propositions=${c}  occurrence=${d}`)
  console.log(`\nTaux conservation : brut→debrief=${a ? Math.round(100 * b / a) : 0}%  debrief→propositions=${b ? Math.round(100 * c / b) : 0}%  propositions→occurrence=${c ? Math.round(100 * d / c) : 0}%`)
}
main().catch(e => { console.error(e); process.exit(1) })
