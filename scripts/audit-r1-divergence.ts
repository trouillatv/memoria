/**
 * R-1 audit READ-ONLY : prouver la divergence timeline-propositions vs occurrence-atomique.
 * Aucun write. Sujet témoin éclairage Bella + inventaire des colonnes disponibles de chaque côté.
 * Usage : npx tsx --env-file=.env.local scripts/audit-r1-divergence.ts
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const CS_ECLAIRAGE = 'cc12fce6-8780-4f93-88a1-21905a37325b'
const THREAD_ECLAIRAGE = '76b118e1-3fcc-4f2e-b03e-4206eb8d1eb4'
const RANK = ['reservation', 'action', 'decision', 'deadline', 'observation', 'knowledge_fact', 'person', 'company']

async function main() {
  // ── Côté PROPOSITIONS (ce que getCanonicalSubjectLife reconstruit) ──
  const { data: props } = await sb.from('document_extraction_proposal')
    .select('id, extraction_run_id, proposal_family, label, document_status, source_page')
    .eq('subject_thread_id', THREAD_ECLAIRAGE)
  const byRun = new Map<string, typeof props>()
  for (const p of props ?? []) { if (!byRun.has(p.extraction_run_id)) byRun.set(p.extraction_run_id, []); byRun.get(p.extraction_run_id)!.push(p) }

  console.log('=== CÔTÉ PROPOSITIONS (reconstruction Ligne de vie — 1 primaire/run) ===')
  for (const [run, ps] of byRun) {
    const sorted = [...ps!].sort((a, b) => RANK.indexOf(a.proposal_family) - RANK.indexOf(b.proposal_family))
    const primary = sorted[0]
    const secondaries = sorted.slice(1)
    console.log(`  run=${run.slice(0, 8)} : ${ps!.length} prop(s)`)
    console.log(`    PRIMAIRE  → [${primary.proposal_family}] ${primary.label.slice(0, 50)} (doc_status=${primary.document_status ?? 'null'})`)
    for (const s of secondaries) console.log(`    secondaire (→ additionalLabels, PAS de position/date propre) → [${s.proposal_family}] ${s.label.slice(0, 50)}`)
  }

  // ── Côté OCCURRENCES (D1+D2) ──
  const { data: occ } = await sb.from('canonical_subject_occurrence')
    .select('state_key, label, effective_date, event_date, evidence_count, validation_status, source_proposal_id')
    .eq('canonical_subject_id', CS_ECLAIRAGE).eq('source_kind', 'historical_pdf')
    .order('effective_date', { ascending: true })
  console.log('\n=== CÔTÉ OCCURRENCES ATOMIQUES (D1 state_key + D2 event_date) ===')
  for (const o of occ ?? []) {
    const pos = o.event_date ?? o.effective_date
    console.log(`  [${o.state_key}] ${o.label.slice(0, 46)} | doc=${o.effective_date} | event=${o.event_date ?? 'null'} | POSITION=${pos} | proof=${o.evidence_count} | src_prop=${o.source_proposal_id ?? 'null'}`)
  }

  // ── Verdict témoin ──
  const hasRealise = (occ ?? []).some((o) => o.state_key === 'knowledge_fact' && o.event_date === '2024-03-22')
  const hasARefaire = (occ ?? []).some((o) => o.state_key === 'action' && !o.event_date)
  console.log('\n=== VERDICT ===')
  console.log(`Occurrence exprime le témoin (réalisé 2024-03-22 + à refaire) : ${hasRealise && hasARefaire ? '✅ OUI' : '❌ NON'}`)
  console.log(`Reconstruction Ligne de vie exprime le témoin : ❌ NON (1 primaire/run, le knowledge_fact daté devient un simple additionalLabel sans position)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
