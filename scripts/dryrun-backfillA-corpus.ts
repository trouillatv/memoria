/**
 * Backfill A — DRY-RUN corpus (SIMULATION, aucune écriture).
 * Simule la re-matérialisation D1+D2 sur tous les rapports historiques : AVANT/APRÈS + anomalies.
 * Règle Vincent : toute explosion/anomalie inattendue → HARD STOP.
 * Usage : npx tsx --env-file=.env.local scripts/dryrun-backfillA-corpus.ts
 */
import { createClient } from '@supabase/supabase-js'
import { isProposalOccurrenceEligible } from '../lib/db/canonical-subject-historical-occurrence'
import { groupPropositionsByState } from '../lib/db/occurrence-state-key'
import { extractEventDate } from '../lib/documents/event-date'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const FAMILIES = ['action', 'decision', 'knowledge_fact', 'deadline', 'reservation', 'observation']

async function main() {
  const { data: occAll } = await sb.from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, site_id, source_ref_id, effective_date').eq('source_kind', 'historical_pdf').limit(100000)
  const legacyByReport = new Map<string, { canonical_subject_id: string; effective_date: string }[]>()
  for (const o of occAll ?? []) {
    if (!legacyByReport.has(o.source_ref_id)) legacyByReport.set(o.source_ref_id, [])
    legacyByReport.get(o.source_ref_id)!.push(o)
  }
  const { data: reports } = await sb.from('site_reports').select('id, site_id, extraction_run_id').in('id', [...legacyByReport.keys()])

  let occBefore = 0, occAfter = 0, multiCouples = 0, sameStateDedup = 0, evFilled = 0, evNull = 0, evAmbig = 0, bellaAfter = 0
  const touchedSubjects = new Set<string>()
  const anomalies: string[] = []

  for (const rep of reports ?? []) {
    if (!rep.extraction_run_id) continue
    const legacy = legacyByReport.get(rep.id) ?? []
    occBefore += legacy.length
    const { data: props } = await sb.from('document_extraction_proposal')
      .select('proposal_family, label, description, source_excerpt, subject_thread_id')
      .eq('extraction_run_id', rep.extraction_run_id).in('proposal_family', FAMILIES).not('subject_thread_id', 'is', null)
    const eligible = (props ?? []).filter((p) => isProposalOccurrenceEligible(p.proposal_family, p.label, p.description))
    if (!eligible.length) continue
    const threadIds = [...new Set(eligible.map((p) => p.subject_thread_id))]
    const t2c = new Map<string, string>()
    for (let i = 0; i < threadIds.length; i += 200) {
      const { data } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', rep.site_id).in('subject_thread_id', threadIds.slice(i, i + 200) as string[])
      for (const s of data ?? []) t2c.set(s.subject_thread_id, s.canonical_subject_id)
    }
    const byCs = new Map<string, typeof eligible>()
    for (const p of eligible) { const c = t2c.get(p.subject_thread_id!); if (!c) continue; if (!byCs.has(c)) byCs.set(c, []); byCs.get(c)!.push(p) }

    for (const [cs, ps] of byCs) {
      touchedSubjects.add(cs)
      const states = groupPropositionsByState(ps)
      occAfter += states.size
      if (rep.site_id === BELLA) bellaAfter += states.size
      if (states.size > 1) multiCouples++
      const doc = legacy.find((o) => o.canonical_subject_id === cs)?.effective_date
      for (const [sk, group] of states) {
        if (group.length > 1) sameStateDedup += group.length - 1
        const ev = sk === 'deadline' ? { iso: null as string | null, ambiguous: false } : extractEventDate(group.flatMap((p) => [p.label, p.description, p.source_excerpt]))
        if (ev.ambiguous) { evAmbig++; anomalies.push(`AMBIGU site=${rep.site_id.slice(0, 8)} ${sk}`) }
        else if (ev.iso) {
          evFilled++
          if (doc && ev.iso > doc) anomalies.push(`EVENT>DOC site=${rep.site_id.slice(0, 8)} ${sk} event=${ev.iso} doc=${doc}`)
          if (ev.iso < '2015-01-01') anomalies.push(`EVENT<2015 site=${rep.site_id.slice(0, 8)} ${sk} ${ev.iso}`)
        } else evNull++
        if (group.length > 1 && sk !== 'deadline') {
          const isos = new Set(group.map((p) => extractEventDate([p.label, p.description, p.source_excerpt]).iso).filter(Boolean))
          if (isos.size > 1) anomalies.push(`SAME-FAMILY-MULTI-DATE site=${rep.site_id.slice(0, 8)} ${sk} dates=${[...isos].join(',')}`)
        }
      }
    }
  }

  console.log('=== BACKFILL A — DRY-RUN CORPUS (aucune écriture) ===')
  console.log(`Rapports historiques : ${reports?.length ?? 0}`)
  console.log(`Occurrences AVANT (legacy) : ${occBefore}`)
  console.log(`Occurrences APRÈS (D1+D2)   : ${occAfter}  (delta +${occAfter - occBefore})`)
  console.log(`Couples (rapport,sujet) multi-état : ${multiCouples}`)
  console.log(`Dédup same-state (propositions poolées) : ${sameStateDedup}`)
  console.log(`event_date renseignées : ${evFilled} | null : ${evNull} | ambiguës(→null) : ${evAmbig}`)
  console.log(`Sujets touchés : ${touchedSubjects.size} | Bella occurrences APRÈS : ${bellaAfter}`)
  console.log(`\n=== ANOMALIES (${anomalies.length}) ===`)
  for (const a of anomalies.slice(0, 40)) console.log('  ⚠️', a)
  if (anomalies.length > 40) console.log(`  … +${anomalies.length - 40}`)
  console.log(`\nExplosion (APRÈS > 2×AVANT) : ${occAfter > occBefore * 2 ? '❌ OUI → HARD STOP' : 'non'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
