/**
 * P3-B1 — Dry-run READ-ONLY du garde d'éligibilité des observations sur Bella Napoli.
 * AUCUNE écriture. Montre : quelles observations deviennent éligibles, et parmi elles combien
 * créeraient une NOUVELLE occurrence (sujet aujourd'hui invisible) vs seraient poolées.
 *
 * Usage : npx tsx --env-file=.env.local scripts/dryrun-p3b1-eligibility.ts
 */

import { createClient } from '@supabase/supabase-js'
import { isProposalOccurrenceEligible } from '../lib/db/canonical-subject-historical-occurrence'

const SITE = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { data: reports } = await sb.from('site_reports').select('id, extraction_run_id').eq('site_id', SITE).not('extraction_run_id', 'is', null)
  const runIds = [...new Set((reports ?? []).map(r => r.extraction_run_id as string))]
  console.log(`Runs Bella : ${runIds.length}`)

  const { data: obs } = await sb.from('document_extraction_proposal')
    .select('id, proposal_family, label, description, subject_thread_id, extraction_run_id')
    .in('extraction_run_id', runIds)
    .eq('proposal_family', 'observation')
    .not('subject_thread_id', 'is', null)
  const observations = obs ?? []
  console.log(`Observations (avec thread) : ${observations.length}\n`)

  // thread → canonical_subject
  const threadIds = [...new Set(observations.map(o => o.subject_thread_id))]
  const { data: sti } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', SITE).in('subject_thread_id', threadIds)
  const threadToCs = new Map((sti ?? []).map(s => [s.subject_thread_id, s.canonical_subject_id]))

  // occurrences existantes par CS
  const csIds = [...new Set([...threadToCs.values()])]
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('canonical_subject_id').in('canonical_subject_id', csIds)
  const occCount = new Map<string, number>()
  for (const o of occ ?? []) occCount.set(o.canonical_subject_id, (occCount.get(o.canonical_subject_id) ?? 0) + 1)

  const { data: cs } = await sb.from('canonical_subject').select('id, label').in('id', csIds)
  const csLabel = new Map((cs ?? []).map(c => [c.id, c.label]))

  let eligible = 0, newOcc = 0, pooled = 0, rejected = 0
  console.log('| Observation | éligible ? | sujet | occ. existantes | effet |')
  console.log('|---|---|---|---|---|')
  for (const o of observations) {
    const elig = isProposalOccurrenceEligible(o.proposal_family, o.label, o.description)
    const csId = threadToCs.get(o.subject_thread_id)
    const existing = csId ? (occCount.get(csId) ?? 0) : 0
    let effet: string
    if (!elig) { effet = '— (rejeté : non significatif)'; rejected++ }
    else { eligible++; if (existing === 0) { effet = '🆕 NOUVELLE occurrence (sujet rendu visible)'; newOcc++ } else { effet = `poolée (evidence++)`; pooled++ } }
    console.log(`| ${(o.label ?? '').slice(0, 46)} | ${elig ? '✅' : '❌'} | ${csId ? (csLabel.get(csId) ?? '?').slice(0, 30) : '—'} | ${existing} | ${effet} |`)
  }

  console.log(`\nÉligibles : ${eligible}/${observations.length} · dont NOUVELLES : ${newOcc} · poolées : ${pooled} · rejetées : ${rejected}`)
  console.log('Attendu P3-A : 2 NOUVELLES (Registre 2024, Largeur 2025) ; le reste poolé ; ~0 rejet (corpus Bella tout significatif).')
  console.log('AUCUNE écriture effectuée (dry-run).')
}

main().catch((e) => { console.error(e); process.exit(1) })
