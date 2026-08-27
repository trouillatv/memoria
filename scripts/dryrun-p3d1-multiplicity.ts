/**
 * P3-D1 — Dry-run (SIMULATION, aucune écriture) : ce que le nouveau workflow atomique produirait.
 *
 * Ne lance PAS ensureHistoricalPdfOccurrences (cela dupliquerait legacy + atomique sur Bella déjà
 * importé → c'est le backfill A, gaté). On rejoue la MÊME logique de groupement (isProposal
 * OccurrenceEligible + deriveStateKey + groupPropositionsByState) sur les propositions réelles et on
 * compte les occurrences par état, en vérifiant que la dédup same-state est préservée.
 *
 * Usage : npx tsx --env-file=.env.local scripts/dryrun-p3d1-multiplicity.ts [--site=<uuid>]
 */

import { createClient } from '@supabase/supabase-js'
import { isProposalOccurrenceEligible } from '../lib/db/canonical-subject-historical-occurrence'
import { groupPropositionsByState } from '../lib/db/occurrence-state-key'

const args = process.argv.slice(2)
const getArg = (n: string) => { const f = args.find((a) => a.startsWith(`--${n}=`)); return f ? f.split('=').slice(1).join('=') : null }
const SITE = getArg('site') ?? 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sep = (l: string) => console.log(`\n${'─'.repeat(64)}\n${l}\n${'─'.repeat(64)}`)

async function main() {
  const { data: reports } = await sb.from('site_reports').select('id, extraction_run_id').eq('site_id', SITE).not('extraction_run_id', 'is', null)
  const runs = (reports ?? []).map((r) => ({ reportId: r.id as string, runId: r.extraction_run_id as string }))

  let totalProps = 0, totalOccBefore = 0, totalOccAfter = 0, multiStateSubjects = 0
  const multiExamples: string[] = []

  for (const run of runs) {
    const { data: props } = await sb.from('document_extraction_proposal')
      .select('proposal_family, label, description, subject_thread_id')
      .eq('extraction_run_id', run.runId)
      .in('proposal_family', ['action', 'decision', 'knowledge_fact', 'deadline', 'reservation', 'observation'])
      .not('subject_thread_id', 'is', null)
    const eligible = (props ?? []).filter((p) => isProposalOccurrenceEligible(p.proposal_family, p.label, p.description))
    totalProps += eligible.length

    // thread → canonical
    const threadIds = [...new Set(eligible.map((p) => p.subject_thread_id))]
    const { data: sti } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', SITE).in('subject_thread_id', threadIds)
    const t2c = new Map((sti ?? []).map((s) => [s.subject_thread_id, s.canonical_subject_id]))

    // grouper par canonical
    const byCs = new Map<string, typeof eligible>()
    for (const p of eligible) {
      const cs = t2c.get(p.subject_thread_id); if (!cs) continue
      if (!byCs.has(cs)) byCs.set(cs, [])
      byCs.get(cs)!.push(p)
    }

    // occurrences AVANT (modèle actuel : 1 par (cs, rapport)) vs APRÈS (1 par état)
    const { data: labels } = await sb.from('canonical_subject').select('id, label').in('id', [...byCs.keys()])
    const csLabel = new Map((labels ?? []).map((c) => [c.id, c.label]))
    for (const [cs, ps] of byCs) {
      totalOccBefore += 1 // ancien modèle : une occurrence poolée
      const states = groupPropositionsByState(ps)
      totalOccAfter += states.size
      if (states.size > 1) {
        multiStateSubjects++
        if (multiExamples.length < 12) {
          multiExamples.push(`  • ${(csLabel.get(cs) ?? cs).slice(0, 40)} → ${states.size} états : ${[...states.entries()].map(([k, v]) => `${k}(${v.length})`).join(', ')}`)
        }
      }
    }
  }

  sep('SIMULATION D1 sur Bella (aucune écriture)')
  console.log(`Propositions éligibles : ${totalProps}`)
  console.log(`Occurrences AVANT (1 par (sujet, rapport), modèle actuel) : ${totalOccBefore}`)
  console.log(`Occurrences APRÈS (1 par état atomique, D1) : ${totalOccAfter}`)
  console.log(`Sujets MULTI-ÉTAT (≥2 états dans un rapport) : ${multiStateSubjects}`)
  console.log(`Delta = +${totalOccAfter - totalOccBefore} occurrences (uniquement les états réellement distincts)\n`)
  console.log('Sujets multi-état (dédup same-state préservée : les reformulations restent 1 état) :')
  for (const e of multiExamples) console.log(e)
  console.log('\nAttendu : les cas cross-family (contrôlé+à faire, réalisé+à refaire) se dédoublent ;')
  console.log('les reformulations same-family restent 1. AUCUNE écriture (simulation).')
}

main().catch((e) => { console.error(e); process.exit(1) })
