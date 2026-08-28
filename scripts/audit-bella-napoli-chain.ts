/** READ-ONLY — trace la CHAÎNE de naissance de « BELLA NAPOLI » :
 *  PDF → document_extraction_proposal → thread → canonical_subject(actor) → occurrence → #230.
 *  Identifie le premier endroit où le système avait de quoi ne pas créer ce sujet. Aucune écriture. */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const BN = 'd911ab4e-89db-4587-8258-18e5c9eb9b93'

async function main() {
  // 1. Le canonical_subject lui-même
  const { data: cs } = await sb.from('canonical_subject').select('*').eq('id', BN).maybeSingle()
  console.log('── 1. canonical_subject BELLA NAPOLI ──')
  console.log(JSON.stringify(cs, null, 1))

  // 2. Threads rattachés (subject_thread_identity)
  const { data: threads } = await sb.from('subject_thread_identity').select('subject_thread_id, site_id, created_at').eq('canonical_subject_id', BN)
  console.log(`\n── 2. subject_thread_identity → ${(threads ?? []).length} thread(s) ──`)
  console.log(JSON.stringify(threads, null, 1))

  // 3. Occurrences (déjà su = 0, on reconfirme)
  const { count: occN } = await sb.from('canonical_subject_occurrence').select('id', { count: 'exact', head: true }).eq('canonical_subject_id', BN)
  console.log(`\n── 3. occurrences = ${occN} ──`)

  // 4. document_extraction_proposal « BELLA NAPOLI » sur le site (famille ? review_status ? run ?)
  const { data: reports } = await sb.from('site_reports').select('id, text_input, extraction_run_id').eq('site_id', BELLA)
  const runIds = ((reports ?? []) as Array<{ id: string; text_input: string | null; extraction_run_id: string | null }>).map((r) => r.extraction_run_id).filter(Boolean) as string[]
  const runToReport = new Map(((reports ?? []) as Array<{ text_input: string | null; extraction_run_id: string | null }>).map((r) => [r.extraction_run_id, r.text_input]))
  const { data: props } = await sb.from('document_extraction_proposal')
    .select('id, label, reviewed_label, proposal_family, review_status, source_page, extraction_run_id, canonical_subject_id')
    .in('extraction_run_id', runIds.length ? runIds : ['-'])
    .ilike('label', '%bella%')
  console.log(`\n── 4. document_extraction_proposal dont label ~ « bella » = ${(props ?? []).length} ──`)
  for (const p of (props ?? []) as Array<Record<string, unknown>>) {
    console.log(`  family=${p.proposal_family} review=${p.review_status} p.${p.source_page} run=${runToReport.get(p.extraction_run_id as string) ?? (p.extraction_run_id as string)?.slice?.(0, 8)}  CS=${(p.canonical_subject_id as string)?.slice?.(0, 8) ?? 'null'}  « ${p.reviewed_label ?? p.label} »`)
  }

  // 5. Liens acteur éventuels (occurrence_actor_link ou actor auto-link) — le sujet est-il utilisé comme acteur ?
  const { data: links } = await sb.from('occurrence_actor_link').select('*').eq('actor_canonical_subject_id', BN).limit(20).then((r) => r).catch(() => ({ data: null }))
  console.log(`\n── 5. occurrence_actor_link où BELLA NAPOLI = acteur → ${links ? (links as unknown[]).length : 'table absente/err'} ──`)
  if (links) console.log(JSON.stringify(links, null, 1))

  console.log('\n(READ-ONLY — trace de naissance, aucune correction.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
