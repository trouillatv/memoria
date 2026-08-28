/** READ-ONLY — via site_reports : le run d'extraction le plus récent du PV Bella émet-il
 *  « BELLA NAPOLI » comme acteur (person/company) ? + d'où vient l'orphan (subject_thread). */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const BN_THREAD = 'acffde06-e5ce-404e-a1c5-76be17bf7bd7'

async function main() {
  const { data: reps } = await sb.from('site_reports').select('id, text_input, origin, extraction_run_id, created_at').eq('site_id', BELLA)
  const reports = (reps ?? []) as Array<{ id: string; text_input: string | null; origin: string | null; extraction_run_id: string | null; created_at: string }>
  console.log('── site_reports Bella ──')
  for (const r of reports) console.log(`  ${r.origin}/${r.text_input}  run=${r.extraction_run_id?.slice(0, 8) ?? 'null'}  ${r.created_at.slice(0, 10)}`)

  const runIds = reports.map((r) => r.extraction_run_id).filter(Boolean) as string[]
  // Acteurs (person/company) émis par ces runs
  const { data: actors } = await sb.from('document_extraction_proposal')
    .select('label, reviewed_label, proposal_family, review_status, extraction_run_id')
    .in('extraction_run_id', runIds.length ? runIds : ['-'])
    .in('proposal_family', ['person', 'company'])
  const a = (actors ?? []) as Array<{ label: string; reviewed_label: string | null; proposal_family: string; review_status: string; extraction_run_id: string }>
  console.log(`\n── acteurs person/company émis par les runs Bella = ${a.length} ──`)
  for (const x of a) console.log(`  ${x.proposal_family}/${x.review_status} run=${x.extraction_run_id.slice(0, 8)}  « ${x.reviewed_label ?? x.label} »`)
  const bnActor = a.find((x) => /bella|napoli/i.test(x.reviewed_label ?? x.label))
  console.log(`\n  → « BELLA NAPOLI » présent comme acteur d'extraction courant ? ${bnActor ? 'OUI ⚠️' : 'NON'}`)

  // Le thread orphelin acffde06 : existe-t-il dans subject_thread ? quel query_text/family ?
  const { data: th } = await sb.from('subject_thread').select('*').eq('id', BN_THREAD).maybeSingle().then((r) => r).catch(() => ({ data: null }))
  console.log('\n── subject_thread acffde06 (source de l\'orphan) ──')
  console.log(th ? JSON.stringify(th, null, 1) : '(table subject_thread absente ou id introuvable)')
}
main().catch((e) => { console.error(e); process.exit(1) })
