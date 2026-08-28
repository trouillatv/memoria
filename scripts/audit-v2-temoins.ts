/** V2 dry-run — témoins + conservation phrase-level + mis-attribution. READ-ONLY, aucune écriture.
 *  Trace les 3 témoins (debrief/proposition → occurrence actuelle → représentation V2 simulée).
 *  Mesure au niveau PHRASE (≥1 sujet mentionné, pas 2 requis) : conservation avant/après, duplication,
 *  phrases >2 sujets, risque de mis-attribution (phrase mentionne un sujet mais note d'un autre).
 */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const REL = /(d[ée]pend|n[ée]cessite|impossible (?:de |tant)|tant qu[e']|avant (?:de |la |le |d')|apr[eè]s (?:validation|la |le |l')|conditionn[ée]|pr[ée]alable|bloqu|emp[êe]ch|permet(?:tra|tre|)? (?:de|le|la)|ne peut(?:vent)? pas|ne pourra|en attente (?:de|d')|requiert|doit être (?:termin|fait|valid|fini)|en remplacement|remplac|suite à|sous r[ée]serve|si .* (?:sont|est) )/i
const STOP = new Set(['dans','pour','avec','sans','sous','les','des','une','due','sur','aux','par','est','sont','sera','entre','leur','cette','chantier','general','générale'])
function norm(s: string) { return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() }
function toks(s: string) { return norm(s).split(' ').filter(t => t.length >= 5 && !STOP.has(t)) }
function sentences(txt: string) { return txt.split(/(?<=[.!?;\n])\s+/).map(s => s.trim()).filter(s => s.length > 12) }

async function main() {
  // ── A. TÉMOINS ────────────────────────────────────────────────────────────
  const temoins = ['carrelage', 'revégétalis', 'reveget', 'cadenas']
  console.log('════════ TÉMOINS — lignée debrief/proposition → occurrence → V2 simulée ════════')
  for (const kw of temoins) {
    const { data: props } = await sb.from('site_knowledge_proposals')
      .select('id, report_id, site_id, kind, title, body, canonical_subject_id').or(`title.ilike.%${kw}%,body.ilike.%${kw}%`).limit(2)
    for (const p of (props ?? []) as Array<Record<string, unknown>>) {
      const phrase = `${p.title ?? ''}. ${p.body ?? ''}`.trim()
      if (!REL.test(phrase)) continue
      // sujets canoniques du report
      const { data: occ } = await sb.from('canonical_subject_occurrence')
        .select('canonical_subject_id, label, note, source_proposal_id').eq('source_ref_id', p.report_id)
      const { data: cs } = await sb.from('canonical_subject').select('id, label, company_id, contact_id').eq('site_id', p.site_id).eq('status', 'active')
      const subjLabel = new Map((cs ?? []).filter((c: Record<string, unknown>) => !c.company_id && !c.contact_id).map((c: Record<string, unknown>) => [c.id as string, c.label as string]))
      const st = new Set(toks(phrase))
      const mentioned = [...(occ ?? []).map((o: Record<string, unknown>) => o.canonical_subject_id as string)]
        .filter((id, i, a) => a.indexOf(id) === i && subjLabel.has(id) && toks(subjLabel.get(id)!).some(t => st.has(t)))
      const inNote = (occ ?? []).some((o: Record<string, unknown>) => REL.test(String(o.note ?? '')) && norm(String(o.note)).includes(norm(phrase).slice(0, 40)))
      console.log(`\n── « ${kw} » — proposition [${p.kind}] report ${String(p.report_id).slice(0, 8)}`)
      console.log(`   PHRASE: « ${phrase.slice(0, 200)} »`)
      console.log(`   sujets canoniques du report mentionnés par la phrase: ${mentioned.length} → ${mentioned.map(id => subjLabel.get(id)).join(' | ')}`)
      console.log(`   conservée dans une note d'occurrence AUJOURD'HUI: ${inNote ? 'oui' : 'NON'}`)
      console.log(`   V2 (Option C) stockerait: subject_relational_evidence{ source_ref=${String(p.report_id).slice(0, 8)}, subject_ids=[${mentioned.map(id => String(id).slice(0, 6)).join(',')}], evidence_text=phrase } → occurrences INCHANGÉES (atomiques)`)
    }
  }

  // ── B. MESURE PHRASE-LEVEL (≥1 sujet mentionné) ───────────────────────────
  const { data: fv } = await sb.from('canonical_subject_occurrence').select('site_id').eq('source_kind', 'field_visit')
  const siteIds = [...new Set((fv ?? []).map((o: Record<string, unknown>) => o.site_id as string))]
  let rel1 = 0, consBefore = 0, dupSum = 0, multi = 0, misattrib = 0
  for (const siteId of siteIds) {
    const { data: cs } = await sb.from('canonical_subject').select('id, label, company_id, contact_id').eq('site_id', siteId).eq('status', 'active')
    const subjLabel = new Map((cs ?? []).filter((c: Record<string, unknown>) => !c.company_id && !c.contact_id).map((c: Record<string, unknown>) => [c.id as string, c.label as string]))
    const { data: occ } = await sb.from('canonical_subject_occurrence').select('source_ref_id, canonical_subject_id, note').eq('site_id', siteId).eq('source_kind', 'field_visit')
    const reps = new Map<string, Array<Record<string, unknown>>>()
    for (const o of (occ ?? []) as Array<Record<string, unknown>>) { const r = o.source_ref_id as string; if (!reps.has(r)) reps.set(r, []); reps.get(r)!.push(o) }
    for (const [reportId, occs] of reps) {
      const subjIds = [...new Set(occs.map(o => o.canonical_subject_id as string))].filter(id => subjLabel.has(id))
      const { data: rep } = await sb.from('site_reports').select('debrief_analysis').eq('id', reportId).maybeSingle()
      const da = ((rep as Record<string, unknown>)?.debrief_analysis ?? {}) as Record<string, unknown>
      const { data: props } = await sb.from('site_knowledge_proposals').select('title, body').eq('report_id', reportId)
      const src = [da.summary, ...((da.actions as Array<Record<string, unknown>> ?? []).map(a => a.rationale)), ...((props ?? []) as Array<Record<string, unknown>>).map(p => `${p.title ?? ''}. ${p.body ?? ''}`)].filter(Boolean).map(String).join('\n')
      const seen = new Set<string>()
      for (const s of sentences(src).filter(x => REL.test(x))) {
        const k = norm(s).slice(0, 80); if (seen.has(k)) continue; seen.add(k)
        const st = new Set(toks(s))
        const ment = subjIds.filter(id => toks(subjLabel.get(id)!).some(t => st.has(t)))
        if (ment.length < 1) continue
        rel1++; dupSum += ment.length; if (ment.length > 2) multi++
        const inSomeNote = occs.some(o => ment.includes(o.canonical_subject_id as string) && norm(String(o.note ?? '')).includes(k.slice(0, 40)))
        if (inSomeNote) consBefore++
        // mis-attribution : la phrase serait attachée à une note de sujet NON mentionné (option A/B naïve)
        const attachedElsewhere = occs.some(o => !ment.includes(o.canonical_subject_id as string) && norm(String(o.note ?? '')).includes(k.slice(0, 40)))
        if (attachedElsewhere) misattrib++
      }
    }
  }
  console.log('\n\n════════ MESURE PHRASE-LEVEL (preuve mentionnant ≥1 sujet du report) ════════')
  console.log(`phrases relationnelles rattachables (≥1 sujet) = ${rel1}`)
  console.log(`  conservées dans une note aujourd'hui = ${consBefore}  (${rel1 ? Math.round(100 * consBefore / rel1) : 0}%)  ← AVANT`)
  console.log(`  V2 Option C : conservées = ${rel1}  (100%)  ← APRÈS (on stocke la phrase)`)
  console.log(`  duplication moyenne (sujets/preuve) = ${rel1 ? (dupSum / rel1).toFixed(2) : 0}`)
  console.log(`  phrases >2 sujets = ${multi}`)
  console.log(`  risque mis-attribution (phrase dans note d'un sujet NON mentionné) = ${misattrib}`)
}
main().catch(e => { console.error(e); process.exit(1) })
