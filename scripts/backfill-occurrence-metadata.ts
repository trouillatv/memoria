/**
 * R-1 — Backfill source_page + thematic_category sur canonical_subject_occurrence (historical_pdf).
 * Rematérialise par le MÊME workflow (le writer écrit désormais source_page + thematic_category +
 * state_status). Rapport instrumenté des conflits de catégorie intra-state_key (univoque/dominant/none,
 * distribution par famille). HARD STOP si conflits nombreux ou sur familles actionnables.
 *
 * Usage : npx tsx --env-file=.env.local scripts/backfill-occurrence-metadata.ts [--apply]
 *         npx tsx --env-file=.env.local scripts/backfill-occurrence-metadata.ts --rollback
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { ensureHistoricalPdfOccurrences } from '../lib/db/canonical-subject-historical-occurrence'
import { isProposalOccurrenceEligible } from '../lib/db/canonical-subject-historical-occurrence'
import { groupPropositionsByState, deriveGroupThematicCategory } from '../lib/db/occurrence-state-key'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const SNAP = '_backfillMeta_snapshot.json'
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const FAMILIES = ['action', 'decision', 'knowledge_fact', 'deadline', 'reservation', 'observation']
const ACTIONABLE = new Set(['action', 'decision', 'deadline', 'reservation'])
const CS = { eclairage: 'cc12fce6-8780-4f93-88a1-21905a37325b', elec: '2504ad1f-99a5-46e2-8c00-12b4aef0f7e9', cuisson: 'b78526f9-9dc6-43f7-8edb-e4278f207988' }

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
  writeFileSync(SNAP, JSON.stringify({ occ: occ ?? [], links }, null, 0))
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
  console.log(`Restauré : ${s.occ.length} occurrences, ${s.links.length} liens.`)
}

async function main() {
  if (ROLLBACK) return rollback()
  const reports = await loadReports()
  console.log(`${APPLY ? '⚠️  APPLY' : 'DRY-RUN'} — ${reports.length} rapports historiques`)
  const before = await snapshot(reports.map((r) => r.id))
  console.log(`Snapshot : ${before.occ.length} occurrences → ${SNAP}`)
  if (!APPLY) { console.log('\nDRY-RUN : rien écrit. --apply pour exécuter.'); return }

  sep('1. Rematérialisation (writer écrit source_page + thematic_category + state_status)')
  let created = 0, errors = 0
  for (const r of reports) {
    await sb.from('canonical_subject_occurrence').delete().eq('source_kind', 'historical_pdf').eq('source_ref_id', r.id)
    const res = await ensureHistoricalPdfOccurrences({ runId: r.extraction_run_id!, siteId: r.site_id, siteReportId: r.id, visitDate: r.visitDate })
    created += res.created; errors += res.errors
  }
  console.log(`  created=${created} errors=${errors}`)

  sep('2. Instrumentation conflits de catégorie (intra-state_key) → null')
  let univocal = 0, conflict = 0, none = 0
  const conflictByFamily = new Map<string, number>()
  const conflictActionable: string[] = []
  for (const r of reports) {
    const { data: props } = await sb.from('document_extraction_proposal')
      .select('proposal_family, label, description, thematic_category, subject_thread_id')
      .eq('extraction_run_id', r.extraction_run_id!).in('proposal_family', FAMILIES).not('subject_thread_id', 'is', null)
    const eligible = (props ?? []).filter((p) => isProposalOccurrenceEligible(p.proposal_family, p.label, p.description))
    const threadIds = [...new Set(eligible.map((p) => p.subject_thread_id))]
    const { data: sti } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', r.site_id).in('subject_thread_id', threadIds as string[])
    const t2c = new Map((sti ?? []).map((s) => [s.subject_thread_id, s.canonical_subject_id]))
    const byCs = new Map<string, typeof eligible>()
    for (const p of eligible) { const c = t2c.get(p.subject_thread_id!); if (!c) continue; if (!byCs.has(c)) byCs.set(c, []); byCs.get(c)!.push(p) }
    for (const ps of byCs.values()) {
      for (const [sk, group] of groupPropositionsByState(ps)) {
        const { reason, distinct } = deriveGroupThematicCategory(group.map((p) => p.thematic_category))
        if (reason === 'univocal') univocal++
        else if (reason === 'none') none++
        else {
          conflict++
          conflictByFamily.set(sk, (conflictByFamily.get(sk) ?? 0) + 1)
          if (ACTIONABLE.has(sk)) conflictActionable.push(`${r.site_id.slice(0, 8)} ${sk} [${distinct.join(',')}]`)
        }
      }
    }
  }
  console.log(`  univoque=${univocal} | conflit→null=${conflict} | aucune=${none}`)
  console.log(`  conflits par famille : ${[...conflictByFamily.entries()].map(([f, n]) => `${f}=${n}`).join(' ') || '(aucun)'}`)
  console.log(`  conflits sur familles ACTIONNABLES (→ null, fallback family) : ${conflictActionable.length}`)
  for (const c of conflictActionable.slice(0, 20)) console.log('    ·', c)

  sep('3. Couverture colonnes + témoin Bella')
  const { count: total } = await sb.from('canonical_subject_occurrence').select('id', { count: 'exact', head: true }).eq('source_kind', 'historical_pdf')
  const { count: withPage } = await sb.from('canonical_subject_occurrence').select('id', { count: 'exact', head: true }).eq('source_kind', 'historical_pdf').not('source_page', 'is', null)
  const { count: withCat } = await sb.from('canonical_subject_occurrence').select('id', { count: 'exact', head: true }).eq('source_kind', 'historical_pdf').not('thematic_category', 'is', null)
  console.log(`  occurrences=${total} | source_page renseignée=${withPage} | thematic_category renseignée=${withCat}`)
  const { data: eclOcc } = await sb.from('canonical_subject_occurrence').select('state_key, state_status, source_page, thematic_category').eq('canonical_subject_id', CS.eclairage).eq('source_kind', 'historical_pdf')
  console.log('  éclairage :', (eclOcc ?? []).map((o) => `${o.state_key}/${o.state_status}/p${o.source_page ?? '-'}/${o.thematic_category ?? '-'}`).join('  '))

  // Règle figée (Vincent) : conflit → null. Aucun choix arbitraire → pas de HARD STOP catégorie.
  const bellaOk = (eclOcc ?? []).some((o) => o.state_key === 'knowledge_fact' && o.state_status === 'resolved')
    && (eclOcc ?? []).some((o) => o.state_key === 'action' && o.state_status === 'open')
  sep(bellaOk ? '✅ BACKFILL métadonnées VALIDÉ (conflit catégorie → null, fallback family)' : '❌ témoin Bella cassé → ROLLBACK')
  if (!bellaOk) { await rollback(); process.exit(1) }
  console.log(`${conflict} conflits → null (instrumentés) ; ${univocal} univoques conservées ; ${none} sans catégorie.`)
  console.log('Rollback : npx tsx --env-file=.env.local scripts/backfill-occurrence-metadata.ts --rollback')
}
main().catch((e) => { console.error(e); process.exit(1) })
