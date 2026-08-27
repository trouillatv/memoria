/**
 * R-1 pré-migration — audit READ-ONLY du statut au niveau state_key. AUCUN write.
 *
 * Reproduit EXACTEMENT le groupement du writer historique (eligible → par sujet → par state_key)
 * et, pour chaque groupe (= future occurrence), collecte les document_status des propositions poolées.
 * Répond aux 6 points: portage du statut, comportement multi-state_key, témoin Bella multi-états,
 * CONTRADICTIONS intra-groupe, distribution corpus, base pour le CHECK.
 *
 * Usage : npx tsx --env-file=.env.local scripts/audit-r1-status-per-statekey.ts
 */
import { createClient } from '@supabase/supabase-js'
import { isProposalOccurrenceEligible } from '../lib/db/canonical-subject-historical-occurrence'
import { groupPropositionsByState } from '../lib/db/occurrence-state-key'
import { documentStatusToPvState, aggregatePvState, type PvState } from '../lib/documents/subject-state'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const FAMILIES = ['action', 'decision', 'knowledge_fact', 'deadline', 'reservation', 'observation']

type Prop = { proposal_family: string; label: string; description: string | null; document_status: string | null; subject_thread_id: string | null }

async function main() {
  // rapports historiques via occurrences existantes
  const { data: occAll } = await sb.from('canonical_subject_occurrence').select('source_ref_id').eq('source_kind', 'historical_pdf').limit(100000)
  const reportIds = [...new Set((occAll ?? []).map((o) => o.source_ref_id))]
  const { data: reports } = await sb.from('site_reports').select('id, site_id, extraction_run_id').in('id', reportIds)

  const dist: Record<PvState, number> = { resolved: 0, open: 0, unknown: 0 }
  let nullOnlyGroups = 0, totalGroups = 0, multiPropGroups = 0
  const contradictions: string[] = []
  const bellaRows: string[] = []
  const rawStatusValues = new Map<string, number>()

  for (const rep of reports ?? []) {
    if (!rep.extraction_run_id) continue
    const { data: props } = await sb.from('document_extraction_proposal')
      .select('proposal_family, label, description, document_status, subject_thread_id')
      .eq('extraction_run_id', rep.extraction_run_id).in('proposal_family', FAMILIES).not('subject_thread_id', 'is', null)
    const eligible = (props ?? []).filter((p) => isProposalOccurrenceEligible(p.proposal_family, p.label, p.description)) as Prop[]
    if (!eligible.length) continue
    const threadIds = [...new Set(eligible.map((p) => p.subject_thread_id!))]
    const { data: sti } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', rep.site_id).in('subject_thread_id', threadIds)
    const t2c = new Map((sti ?? []).map((s) => [s.subject_thread_id, s.canonical_subject_id]))
    const byCs = new Map<string, Prop[]>()
    for (const p of eligible) { const c = t2c.get(p.subject_thread_id!); if (!c) continue; if (!byCs.has(c)) byCs.set(c, []); byCs.get(c)!.push(p) }

    for (const [cs, ps] of byCs) {
      for (const [sk, group] of groupPropositionsByState(ps)) {
        totalGroups++
        if (group.length > 1) multiPropGroups++
        const statuses = group.map((p) => p.document_status)
        for (const s of statuses) rawStatusValues.set(s ?? 'NULL', (rawStatusValues.get(s ?? 'NULL') ?? 0) + 1)
        const mapped = statuses.map(documentStatusToPvState)
        const agg = aggregatePvState(statuses)
        dist[agg]++
        if (statuses.every((s) => s === null)) nullOnlyGroups++
        // CONTRADICTION = le groupe contient à la fois un resolved ET un open (conflit réel intra-état)
        if (mapped.includes('resolved') && mapped.includes('open'))
          contradictions.push(`site=${rep.site_id.slice(0, 8)} cs=${cs.slice(0, 8)} state_key=${sk} statuses=[${statuses.join(',')}]`)
        if (rep.site_id === BELLA)
          bellaRows.push(`  cs=${cs.slice(0, 8)} [${sk}] → ${agg}  (statuts bruts: ${statuses.map((s) => s ?? 'null').join(',')})`)
      }
    }
  }

  console.log('=== R-1 AUDIT STATUT — niveau state_key (groupe = future occurrence) ===')
  console.log(`Groupes state_key (futures occurrences) : ${totalGroups} | multi-proposition : ${multiPropGroups}`)
  console.log(`Distribution tri-state par groupe : resolved=${dist.resolved} open=${dist.open} unknown=${dist.unknown}`)
  console.log(`Groupes 100% null (→ unknown explicite) : ${nullOnlyGroups}`)
  console.log(`\nValeurs document_status brutes rencontrées :`)
  for (const [v, n] of [...rawStatusValues.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v} : ${n}`)
  console.log(`\n=== CONTRADICTIONS intra-groupe (resolved ET open dans un même state_key) : ${contradictions.length} ===`)
  for (const c of contradictions.slice(0, 40)) console.log('  ⚠️', c)
  console.log(`\n=== BELLA — statut par occurrence atomique ===`)
  for (const r of bellaRows) console.log(r)
  console.log(`\nVERDICT : ${contradictions.length === 0 ? '✅ statut attribuable sans ambiguïté au niveau state_key' : '❌ contradictions → HARD STOP avant migration'}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
