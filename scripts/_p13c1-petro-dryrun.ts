// P1-3C.1 dry-run — PETRO : audit de rattachement action/deadline → canonical_subject
// Mode lecture seule. Aucune mutation DB.
// Usage : npx tsx scripts/_p13c1-petro-dryrun.ts
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { resolveCanonicalSubjectReference } from '../lib/db/canonical-subject-resolve'

const PETRO_SITE = '75bd3d23-d515-46bd-8de8-254495a5bade'

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Charger les 17 actions PETRO (sans canonical_subject_id — colonne pas encore appliquée)
  const { data: actions, error: actErr } = await supabase
    .from('site_actions')
    .select('id, title, status, subject_thread_id')
    .eq('site_id', PETRO_SITE)
    .order('status')

  if (actErr) { console.error('Erreur actions:', actErr.message); process.exit(1) }

  const actionsArr = (actions ?? []) as Array<{
    id: string; title: string; status: string;
    subject_thread_id: string | null
  }>
  console.log(`\n=== DRY-RUN P1-3C.1 — PETRO site_actions (${actionsArr.length} total) ===\n`)

  // Charger les deadlines PETRO
  const { data: deadlines, error: dlErr } = await supabase
    .from('site_deadlines')
    .select('id, title, status')
    .eq('site_id', PETRO_SITE)
    .order('status')

  if (dlErr) { console.error('Erreur deadlines:', dlErr.message); process.exit(1) }

  const deadlinesArr = (deadlines ?? []) as Array<{
    id: string; title: string; status: string
  }>
  console.log(`site_deadlines : ${deadlinesArr.length} total\n`)

  // Audit actions
  console.log('--- site_actions ---')
  const rows: string[] = []
  let linked = 0, ambiguous = 0, notFound = 0

  for (const a of actionsArr) {
    if (a.subject_thread_id) {
      rows.push(`  THREAD    | ${a.status.padEnd(10)} | ${a.title.slice(0, 60)} | thread=${a.subject_thread_id.slice(0, 8)} (PV path)`)
      continue
    }

    const res = await resolveCanonicalSubjectReference(PETRO_SITE, a.title)
    if (res.kind === 'resolved') {
      rows.push(`  LINK ✓    | ${a.status.padEnd(10)} | ${a.title.slice(0, 60)} | → ${res.candidate.label.slice(0, 40)} [${res.candidate.id.slice(0, 8)}]`)
      linked++
    } else if (res.kind === 'ambiguous') {
      const cands = res.candidates.map(c => c.label.slice(0, 25)).join(' / ')
      rows.push(`  AMBIGUOUS | ${a.status.padEnd(10)} | ${a.title.slice(0, 60)} | candidats: ${cands}`)
      ambiguous++
    } else {
      rows.push(`  NOT_FOUND | ${a.status.padEnd(10)} | ${a.title.slice(0, 60)} | (aucun sujet)`)
      notFound++
    }
  }

  for (const r of rows) console.log(r)

  console.log(`\nRésumé actions: ${linked} LINK, ${ambiguous} AMBIGUOUS, ${notFound} NOT_FOUND`)

  // Audit deadlines
  console.log('\n--- site_deadlines ---')
  const dlRows: string[] = []
  let dlLinked = 0, dlAmbiguous = 0, dlNotFound = 0

  for (const d of deadlinesArr) {
    const res = await resolveCanonicalSubjectReference(PETRO_SITE, d.title)
    if (res.kind === 'resolved') {
      dlRows.push(`  LINK ✓    | ${d.status.padEnd(10)} | ${d.title.slice(0, 60)} | → ${res.candidate.label.slice(0, 40)} [${res.candidate.id.slice(0, 8)}]`)
      dlLinked++
    } else if (res.kind === 'ambiguous') {
      const cands = res.candidates.map(c => c.label.slice(0, 25)).join(' / ')
      dlRows.push(`  AMBIGUOUS | ${d.status.padEnd(10)} | ${d.title.slice(0, 60)} | candidats: ${cands}`)
      dlAmbiguous++
    } else {
      dlRows.push(`  NOT_FOUND | ${d.status.padEnd(10)} | ${d.title.slice(0, 60)} | (aucun sujet)`)
      dlNotFound++
    }
  }

  for (const r of dlRows) console.log(r)
  console.log(`\nRésumé deadlines: ${dlLinked} LINK, ${dlAmbiguous} AMBIGUOUS, ${dlNotFound} NOT_FOUND`)

  console.log('\n=== FIN DRY-RUN — AUCUNE ÉCRITURE EFFECTUÉE ===')
}

main().catch(e => { console.error(e); process.exit(1) })
