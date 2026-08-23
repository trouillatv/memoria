// P1-3B sentinel — cohérence doctrine OCEF
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { documentStatusToPvState, aggregatePvState } from '../lib/documents/subject-state'

const OCEF_SITE = '2c939e67-e986-4635-86a0-638cda870480'

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: runs } = await supabase
    .from('document_extraction_run')
    .select('id')
    .eq('target_site_id', OCEF_SITE)
    .eq('is_canonical', true)
  const runIds = (runs ?? []).map((r: { id: string }) => r.id)
  console.log('Runs canoniques OCEF:', runIds.length)

  const { data: props } = await supabase
    .from('document_extraction_proposal')
    .select('document_status, proposal_family')
    .in('extraction_run_id', runIds)
    .not('subject_thread_id', 'is', null)
  const propsArr = (props ?? []) as Array<{ document_status: string | null; proposal_family: string }>
  console.log('Propositions avec thread:', propsArr.length)

  // Distribution des statuts bruts
  const statDist: Record<string, number> = {}
  for (const p of propsArr) {
    const k = p.document_status ?? '__null__'
    statDist[k] = (statDist[k] ?? 0) + 1
  }
  console.log('Statuts bruts:', JSON.stringify(statDist))

  // Distribution tri-state
  const stateTally = { open: 0, resolved: 0, unknown: 0 }
  for (const p of propsArr) {
    stateTally[documentStatusToPvState(p.document_status)]++
  }
  console.log('Tri-state:', JSON.stringify(stateTally))

  // Invariants fondamentaux
  let ok = true

  const aggNull = aggregatePvState([null, null, null])
  if (aggNull !== 'unknown') { console.error('FAIL: aggregatePvState([null,null,null]) =', aggNull, '(attendu: unknown)'); ok = false }
  else console.log('OK: aggregatePvState([null,null,null]) = unknown')

  const aggOpen = aggregatePvState([null, 'open', null])
  if (aggOpen !== 'open') { console.error('FAIL: aggregatePvState([null,open,null]) =', aggOpen, '(attendu: open)'); ok = false }
  else console.log('OK: aggregatePvState([null,open,null]) = open')

  const aggDone = aggregatePvState([null, 'done', 'open'])
  if (aggDone !== 'resolved') { console.error('FAIL: aggregatePvState([null,done,open]) =', aggDone, '(attendu: resolved)'); ok = false }
  else console.log('OK: aggregatePvState([null,done,open]) = resolved')

  // Vérification : toutes les propositions OCEF à status null → unknown (jamais false-open)
  const nullProps = propsArr.filter(p => p.document_status === null)
  const wronglyOpen = nullProps.filter(p => documentStatusToPvState(p.document_status) !== 'unknown')
  if (wronglyOpen.length > 0) {
    console.error('FAIL:', wronglyOpen.length, 'propositions null mappées incorrectement')
    ok = false
  } else {
    console.log('OK:', nullProps.length, 'propositions null → toutes unknown (0 faux-open)')
  }

  if (ok) {
    console.log('\nSENTINEL: COHERENT ✓')
  } else {
    console.error('\nSENTINEL: FAIL')
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
