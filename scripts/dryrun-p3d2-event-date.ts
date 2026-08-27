/**
 * P3-D2 — Dry-run (SIMULATION, aucune écriture) : event_date proposée par état atomique sur Bella.
 *
 * Applique la logique D1 (dédup same-state) + D2 (extractEventDate) sur les propositions réelles.
 * Table : Sujet | État | document_date | event_date proposée | preuve. Signale les dates ambiguës.
 *
 * Usage : npx tsx --env-file=.env.local scripts/dryrun-p3d2-event-date.ts
 */

import { createClient } from '@supabase/supabase-js'
import { isProposalOccurrenceEligible } from '../lib/db/canonical-subject-historical-occurrence'
import { groupPropositionsByState } from '../lib/db/occurrence-state-key'
import { extractEventDate } from '../lib/documents/event-date'

const SITE = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { data: reports } = await sb.from('site_reports').select('id, extraction_run_id').eq('site_id', SITE).not('extraction_run_id', 'is', null)
  const rows: string[] = ['| Sujet | État | document_date | event_date proposée | preuve |', '|---|---|---|---|---|']
  const ambiguous: string[] = []

  for (const rep of reports ?? []) {
    // date documentaire du rapport (via une occurrence existante)
    const { data: anyOcc } = await sb.from('canonical_subject_occurrence').select('effective_date').eq('source_ref_id', rep.id).eq('source_kind', 'historical_pdf').limit(1).maybeSingle()
    const docDate = anyOcc?.effective_date ?? '?'

    const { data: props } = await sb.from('document_extraction_proposal')
      .select('proposal_family, label, description, source_excerpt, subject_thread_id')
      .eq('extraction_run_id', rep.extraction_run_id)
      .in('proposal_family', ['action', 'decision', 'knowledge_fact', 'deadline', 'reservation', 'observation'])
      .not('subject_thread_id', 'is', null)
    const eligible = (props ?? []).filter((p) => isProposalOccurrenceEligible(p.proposal_family, p.label, p.description))

    const threadIds = [...new Set(eligible.map((p) => p.subject_thread_id))]
    const { data: sti } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', SITE).in('subject_thread_id', threadIds)
    const t2c = new Map((sti ?? []).map((s) => [s.subject_thread_id, s.canonical_subject_id]))
    const csIds = [...new Set([...t2c.values()])]
    const { data: cs } = await sb.from('canonical_subject').select('id, label').in('id', csIds)
    const csLabel = new Map((cs ?? []).map((c) => [c.id, c.label]))

    const byCs = new Map<string, typeof eligible>()
    for (const p of eligible) { const c = t2c.get(p.subject_thread_id); if (!c) continue; if (!byCs.has(c)) byCs.set(c, []); byCs.get(c)!.push(p) }

    for (const [csId, ps] of byCs) {
      const label = (csLabel.get(csId) ?? csId).slice(0, 34)
      for (const [stateKey, group] of groupPropositionsByState(ps)) {
        // Aligné sur le workflow : un état deadline ne porte jamais d'event_date (c'est une échéance).
        const ev = stateKey === 'deadline'
          ? { iso: null, ambiguous: false, evidence: group[0].label }
          : extractEventDate(group.flatMap((p) => [p.label, p.description, p.source_excerpt]))
        const preuve = (ev.evidence ?? group[0].label ?? '').slice(0, 40).replace(/\|/g, '/')
        rows.push(`| ${label} | ${stateKey} | ${docDate} | ${ev.iso ?? '— (null)'}${ev.ambiguous ? ' ⚠️AMBIGU' : ''} | ${preuve} |`)
        if (ev.ambiguous) ambiguous.push(`${label} / ${stateKey} : ${ev.evidence}`)
      }
    }
  }

  console.log('\n' + rows.join('\n'))
  console.log(`\nDates ambiguës (non tranchées, → null) : ${ambiguous.length}`)
  for (const a of ambiguous) console.log(`  ⚠️ ${a}`)
  console.log('\nAttendu : « contrôlé/réalisé le JJ/MM/AAAA » → event_date passée ; « à refaire », échéances,')
  console.log('dates partielles (04/23) → null (position = document_date). AUCUNE écriture (simulation).')
}

main().catch((e) => { console.error(e); process.exit(1) })
