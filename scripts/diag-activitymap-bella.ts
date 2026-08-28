/** Diag READ-ONLY — pourquoi getActivityMap renvoie 0 ligne pour Bella. Réplique son pipeline. */
import { createClient } from '@supabase/supabase-js'
import { canonicalRunsForSite } from '../lib/documents/pv-history'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function main() {
  const runs = await canonicalRunsForSite(BELLA)
  const runIds = runs.map((r) => r.id)
  console.log(`runs = ${runIds.length}`)

  // subject_thread_identity du site (thread → canonical)
  const { data: sti } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', BELLA)
  const threadToCs = new Map(((sti ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>).map((r) => [r.subject_thread_id, r.canonical_subject_id]))
  console.log(`subject_thread_identity (threads mappés au canonical) = ${threadToCs.size}`)

  // propositions des runs Bella
  const { data: props } = await sb.from('document_extraction_proposal')
    .select('id, extraction_run_id, subject_thread_id, document_status, proposal_family')
    .in('extraction_run_id', runIds.length ? runIds : ['-'])
  const proposals = (props ?? []) as Array<{ id: string; extraction_run_id: string; subject_thread_id: string | null; document_status: string | null; proposal_family: string }>
  const withThread = proposals.filter((p) => p.subject_thread_id)
  const mapped = withThread.filter((p) => threadToCs.has(p.subject_thread_id!))
  console.log(`propositions total = ${proposals.length}`)
  console.log(`  avec subject_thread_id = ${withThread.length}`)
  console.log(`  dont le thread est mappé au canonical (threadToCs) = ${mapped.length}  ⇐ SEULES celles-ci alimentent getActivityMap`)

  // distinct threads des propositions vs threads mappés
  const propThreads = new Set(withThread.map((p) => p.subject_thread_id!))
  const propThreadsMapped = [...propThreads].filter((t) => threadToCs.has(t))
  console.log(`  threads distincts dans les propositions = ${propThreads.size} · mappés = ${propThreadsMapped.length}`)

  // canonical actifs
  const { data: cs } = await sb.from('canonical_subject').select('id, label, kind').eq('site_id', BELLA).eq('status', 'active')
  const active = (cs ?? []) as Array<{ id: string; label: string; kind: string | null }>
  console.log(`canonical_subject actifs = ${active.length} (business=${active.filter((c) => c.kind === 'business_subject').length}, actor=${active.filter((c) => c.kind === 'actor').length})`)

  // combien de canonical ont ≥1 proposition mappée (donc pvCount>0 dans getActivityMap)
  const csWithMappedProps = new Set(mapped.map((p) => threadToCs.get(p.subject_thread_id!)!))
  console.log(`canonical avec ≥1 proposition mappée (pvCount>0) = ${csWithMappedProps.size}`)
  console.log('  → si 0, getActivityMap saute TOUS les sujets (pvCount===0) → 0 ligne, grille vide.')

  // Où vivent réellement les états ? occurrences
  const { count: occN } = await sb.from('canonical_subject_occurrence').select('id', { count: 'exact', head: true }).eq('site_id', BELLA)
  console.log(`\ncanonical_subject_occurrence (Bella) = ${occN}  ⇐ la vérité occurrence-first EXISTE`)
}
main().catch((e) => { console.error(e); process.exit(1) })
