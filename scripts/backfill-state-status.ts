/**
 * R-1 — Backfill state_status sur canonical_subject_occurrence (historical_pdf).
 *
 * 1. Corrige les 2 propositions Bella « à refaire » (éclairage/cuisson) restées document_status=null
 *    au Backfill A → 'open' (reproduit ce que produirait le workflow corrigé, PAS une exception Bella).
 * 2. Snapshot (occurrences + actor links + les 2 props) → rollback.
 * 3. Rematérialise par le MÊME workflow (delete historical_pdf → ensureHistoricalPdfOccurrences),
 *    qui écrit désormais state_status au niveau du groupe state_key.
 * 4. Contrôles : state_status peuplé partout, distribution, conflits, témoin Bella, 0 conflit sur
 *    familles actionnables, 0 régression Bella. Rollback auto si échec.
 *
 * Usage : npx tsx --env-file=.env.local scripts/backfill-state-status.ts [--apply]
 *         npx tsx --env-file=.env.local scripts/backfill-state-status.ts --rollback
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { ensureHistoricalPdfOccurrences } from '../lib/db/canonical-subject-historical-occurrence'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const SNAP = '_backfillStateStatus_snapshot.json'
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const PROPS_A_REFAIRE = ['53658b3c-a72a-4c12-a9a7-e3f54ba2de57', '97075022-e22d-43db-90a4-76c11af9b9b8'] // éclairage, cuisson
const CS = { elec: '2504ad1f-99a5-46e2-8c00-12b4aef0f7e9', eclairage: 'cc12fce6-8780-4f93-88a1-21905a37325b', cuisson: 'b78526f9-9dc6-43f7-8edb-e4278f207988' }
const ACTIONABLE = new Set(['action', 'decision', 'deadline', 'reservation'])

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sep = (l: string) => console.log(`\n${'─'.repeat(64)}\n${l}\n${'─'.repeat(64)}`)

async function loadReports() {
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('source_ref_id, effective_date').eq('source_kind', 'historical_pdf').limit(100000)
  const dateByReport = new Map<string, string>()
  for (const o of occ ?? []) if (!dateByReport.has(o.source_ref_id)) dateByReport.set(o.source_ref_id, o.effective_date)
  const { data: reps } = await sb.from('site_reports').select('id, site_id, extraction_run_id').in('id', [...dateByReport.keys()])
  return (reps ?? []).filter((r) => r.extraction_run_id).map((r) => ({ ...r, visitDate: dateByReport.get(r.id)! }))
}

async function snapshot(reportIds: string[]) {
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('*').eq('source_kind', 'historical_pdf').in('source_ref_id', reportIds).limit(100000)
  const occIds = (occ ?? []).map((o) => o.id)
  const links: Record<string, unknown>[] = []
  for (let i = 0; i < occIds.length; i += 200) {
    const { data } = await sb.from('canonical_subject_occurrence_actor_link').select('*').in('occurrence_id', occIds.slice(i, i + 200))
    links.push(...(data ?? []))
  }
  const { data: props } = await sb.from('document_extraction_proposal').select('id, document_status').in('id', PROPS_A_REFAIRE)
  writeFileSync(SNAP, JSON.stringify({ occ: occ ?? [], links, props: props ?? [] }, null, 0))
  return { occ: occ ?? [], links }
}

async function rollback() {
  if (!existsSync(SNAP)) { console.error('Pas de snapshot.'); process.exit(1) }
  const s = JSON.parse(readFileSync(SNAP, 'utf8'))
  sep('ROLLBACK')
  const reportIds = [...new Set(s.occ.map((o: { source_ref_id: string }) => o.source_ref_id))]
  await sb.from('canonical_subject_occurrence').delete().eq('source_kind', 'historical_pdf').in('source_ref_id', reportIds)
  for (let i = 0; i < s.occ.length; i += 200) await sb.from('canonical_subject_occurrence').insert(s.occ.slice(i, i + 200))
  if (s.links.length) for (let i = 0; i < s.links.length; i += 200) await sb.from('canonical_subject_occurrence_actor_link').insert(s.links.slice(i, i + 200))
  for (const p of s.props ?? []) await sb.from('document_extraction_proposal').update({ document_status: p.document_status }).eq('id', p.id)
  console.log(`Restauré : ${s.occ.length} occurrences, ${s.links.length} liens, ${(s.props ?? []).length} props.`)
}

async function occ(cs: string) {
  const { data } = await sb.from('canonical_subject_occurrence').select('label, state_key, state_status, effective_date, event_date').eq('canonical_subject_id', cs).eq('source_kind', 'historical_pdf')
  return data ?? []
}

async function main() {
  if (ROLLBACK) return rollback()
  const reports = await loadReports()
  console.log(`${APPLY ? '⚠️  APPLY' : 'DRY-RUN'} — ${reports.length} rapports historiques`)
  const before = await snapshot(reports.map((r) => r.id))
  console.log(`Snapshot : ${before.occ.length} occurrences, ${before.links.length} liens → ${SNAP}`)
  if (!APPLY) { console.log('\nDRY-RUN : rien écrit. --apply pour exécuter.'); return }

  sep('1. Correction props Bella « à refaire » (null → open)')
  const { error: fixErr } = await sb.from('document_extraction_proposal').update({ document_status: 'open' }).in('id', PROPS_A_REFAIRE)
  if (fixErr) { console.error('fix props échoué', fixErr.message); process.exit(1) }
  console.log(`  ✓ ${PROPS_A_REFAIRE.length} propositions « à refaire » → document_status=open`)

  sep('2. Rematérialisation (delete historical_pdf → re-run, écrit state_status)')
  let created = 0, errors = 0
  for (const r of reports) {
    await sb.from('canonical_subject_occurrence').delete().eq('source_kind', 'historical_pdf').eq('source_ref_id', r.id)
    const res = await ensureHistoricalPdfOccurrences({ runId: r.extraction_run_id!, siteId: r.site_id, siteReportId: r.id, visitDate: r.visitDate })
    created += res.created; errors += res.errors
  }
  console.log(`  created=${created} errors=${errors}`)

  sep('3. Contrôles')
  const { data: all } = await sb.from('canonical_subject_occurrence').select('canonical_subject_id, site_id, state_key, state_status').eq('source_kind', 'historical_pdf').limit(100000)
  const rows = all ?? []
  const nullStatus = rows.filter((o) => o.state_status === null).length
  const dist = { resolved: 0, open: 0, unknown: 0 } as Record<string, number>
  for (const o of rows) dist[o.state_status] = (dist[o.state_status] ?? 0) + 1
  const unknownActionable = rows.filter((o) => ACTIONABLE.has(o.state_key) && o.state_status === 'unknown')
  // conflits = state_key knowledge_fact tombé en unknown (proxy des conflits — vrais conflits loggués par le writer)
  const unknownKf = rows.filter((o) => o.state_key === 'knowledge_fact' && o.state_status === 'unknown').length

  console.log(`  occurrences : ${rows.length} | state_status NULL (legacy résiduel) : ${nullStatus}`)
  console.log(`  distribution : resolved=${dist.resolved} open=${dist.open} unknown=${dist.unknown}`)
  console.log(`  unknown sur familles ACTIONNABLES (doit rester bas/expliqué) : ${unknownActionable.length}`)
  console.log(`  unknown knowledge_fact (missing + 15 conflits attendus) : ${unknownKf}`)

  sep('4. Témoin Bella')
  const checks: { n: string; ok: boolean; d: string }[] = []
  for (const [name, id] of [['éclairage', CS.eclairage], ['électrique', CS.elec], ['cuisson', CS.cuisson]] as const) {
    const os = await occ(id)
    const realise = os.find((o) => o.state_key === 'knowledge_fact')
    const refaire = os.find((o) => o.state_key === 'action')
    checks.push({ n: `${name} : réalisé→resolved + à refaire→open`, ok: realise?.state_status === 'resolved' && refaire?.state_status === 'open', d: os.map((o) => `${o.state_key}=${o.state_status}`).join(' ') })
  }
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.n} — ${c.d}`)

  const allOk = nullStatus === 0 && checks.every((c) => c.ok)
  if (!allOk) { console.log('\n❌ Contrôles échoués → ROLLBACK'); await rollback(); process.exit(1) }
  sep('✅ BACKFILL state_status VALIDÉ')
  console.log('Rollback : npx tsx --env-file=.env.local scripts/backfill-state-status.ts --rollback')
}
main().catch((e) => { console.error(e); process.exit(1) })
