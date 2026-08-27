/**
 * Backfill A — rematérialisation D1+D2 du corpus historique (MODÈLE DE DONNÉES uniquement).
 *
 * 1. Atomise la proposition composite Bella (élec/éclairage/cuisson à refaire), même source/preuve.
 * 2. Snapshot complet (occurrences + actor links + composite) → fichier JSON pour rollback.
 * 3. Pour chaque rapport historique : supprime les occurrences historical_pdf, re-run
 *    ensureHistoricalPdfOccurrences (D1 state_key + D2 event_date).
 * 4. Vérifie le témoin éclairage + acquis Bella + anomalies corpus. Rollback auto si échec.
 *
 * NE touche PAS getCanonicalSubjectLife (Ligne de vie = phase restitution R-1).
 * Usage : npx tsx --env-file=.env.local scripts/backfill-a-execute.ts [--apply]
 *         npx tsx --env-file=.env.local scripts/backfill-a-execute.ts --rollback
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { ensureHistoricalPdfOccurrences } from '../lib/db/canonical-subject-historical-occurrence'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
const SNAP = '_backfillA_snapshot.json'
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const COMPOSITE_ID = 'd2216c34-db4e-46d6-bf0e-f67dac8929d2'
const CS = { elec: '2504ad1f-99a5-46e2-8c00-12b4aef0f7e9', eclairage: 'cc12fce6-8780-4f93-88a1-21905a37325b', cuisson: 'b78526f9-9dc6-43f7-8edb-e4278f207988', registre: '71db6b00-3d03-4bc6-879f-067d92b4a3f9' }
const THREAD_ECLAIRAGE = '76b118e1-3fcc-4f2e-b03e-4206eb8d1eb4'
const THREAD_CUISSON = 'f681e289-fda2-4d85-b2c6-938085ee0abf'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sep = (l: string) => console.log(`\n${'─'.repeat(64)}\n${l}\n${'─'.repeat(64)}`)

async function loadReports() {
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('source_ref_id, effective_date').eq('source_kind', 'historical_pdf').limit(100000)
  const dateByReport = new Map<string, string>()
  for (const o of occ ?? []) if (!dateByReport.has(o.source_ref_id)) dateByReport.set(o.source_ref_id, o.effective_date)
  const { data: reps } = await sb.from('site_reports').select('id, site_id, extraction_run_id').in('id', [...dateByReport.keys()])
  return (reps ?? []).filter((r) => r.extraction_run_id).map((r) => ({ ...r, visitDate: dateByReport.get(r.id)! }))
}

async function snapshot(reports: { id: string }[]) {
  const reportIds = reports.map((r) => r.id)
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('*').eq('source_kind', 'historical_pdf').in('source_ref_id', reportIds).limit(100000)
  const occIds = (occ ?? []).map((o) => o.id)
  const links: Record<string, unknown>[] = []
  for (let i = 0; i < occIds.length; i += 200) {
    const { data } = await sb.from('canonical_subject_occurrence_actor_link').select('*').in('occurrence_id', occIds.slice(i, i + 200))
    links.push(...(data ?? []))
  }
  const { data: comp } = await sb.from('document_extraction_proposal').select('id, label, description').eq('id', COMPOSITE_ID).maybeSingle()
  writeFileSync(SNAP, JSON.stringify({ occ: occ ?? [], links, composite: comp, newPropIds: [] as string[] }, null, 0))
  return { occ: occ ?? [], links }
}

async function rollback() {
  if (!existsSync(SNAP)) { console.error('Pas de snapshot.'); process.exit(1) }
  const s = JSON.parse(readFileSync(SNAP, 'utf8'))
  sep('ROLLBACK')
  const reportIds = [...new Set(s.occ.map((o: { source_ref_id: string }) => o.source_ref_id))]
  // supprimer occurrences actuelles (les liens cascade) puis réinsérer le snapshot
  await sb.from('canonical_subject_occurrence').delete().eq('source_kind', 'historical_pdf').in('source_ref_id', reportIds)
  for (let i = 0; i < s.occ.length; i += 200) await sb.from('canonical_subject_occurrence').insert(s.occ.slice(i, i + 200))
  if (s.links.length) for (let i = 0; i < s.links.length; i += 200) await sb.from('canonical_subject_occurrence_actor_link').insert(s.links.slice(i, i + 200))
  // restaurer composite + supprimer les nouvelles propositions
  if (s.composite) await sb.from('document_extraction_proposal').update({ label: s.composite.label, description: s.composite.description }).eq('id', COMPOSITE_ID)
  if (s.newPropIds?.length) await sb.from('document_extraction_proposal').delete().in('id', s.newPropIds)
  console.log(`Restauré : ${s.occ.length} occurrences, ${s.links.length} liens ; composite restauré ; ${s.newPropIds?.length ?? 0} props supprimées.`)
}

async function atomizeComposite() {
  const { data: comp } = await sb.from('document_extraction_proposal').select('*').eq('id', COMPOSITE_ID).single()
  const base = { extraction_run_id: comp.extraction_run_id, organization_id: comp.organization_id, document_id: comp.document_id, proposal_family: 'action', source_excerpt: comp.source_excerpt, source_page: comp.source_page, source_payload: { statusAtDocumentDate: 'ouvert', thematic_category: 'test_control', relevanceScore: 'strong' } }
  // électrique = composite relabelé (garde son thread → électrique)
  await sb.from('document_extraction_proposal').update({ label: 'Contrôle des installations électriques à refaire', description: 'Le contrôle des installations électriques est en retard et doit être refait immédiatement.' }).eq('id', COMPOSITE_ID)
  const newIds: string[] = []
  const { data: ec } = await sb.from('document_extraction_proposal').insert({ ...base, label: "Contrôle de l'éclairage de sécurité à refaire", description: "Le contrôle de l'éclairage de sécurité est en retard et doit être refait immédiatement.", subject_thread_id: THREAD_ECLAIRAGE }).select('id').single()
  newIds.push(ec.id)
  const { data: cu } = await sb.from('document_extraction_proposal').insert({ ...base, label: 'Contrôle des appareils de cuisson à refaire', description: 'Le contrôle des appareils de cuisson est en retard et doit être refait immédiatement.', subject_thread_id: THREAD_CUISSON }).select('id').single()
  newIds.push(cu.id)
  // enregistrer les newPropIds dans le snapshot pour le rollback
  const s = JSON.parse(readFileSync(SNAP, 'utf8')); s.newPropIds = newIds; writeFileSync(SNAP, JSON.stringify(s, null, 0))
  console.log(`  ✓ composite atomisé → électrique (relabel) + éclairage(${ec.id.slice(0, 8)}) + cuisson(${cu.id.slice(0, 8)})`)
}

async function occ(cs: string, report?: string) {
  let q = sb.from('canonical_subject_occurrence').select('label, state_key, effective_date, event_date, source_ref_id, source_kind').eq('canonical_subject_id', cs)
  if (report) q = q.eq('source_ref_id', report)
  const { data } = await q
  return data ?? []
}

async function main() {
  if (ROLLBACK) return rollback()
  const reports = await loadReports()
  const bella = reports.filter((r) => r.site_id === BELLA)
  console.log(`${APPLY ? '⚠️  APPLY' : 'DRY-RUN'} — ${reports.length} rapports historiques (dont ${bella.length} Bella)`)

  const before = await snapshot(reports)
  console.log(`Snapshot : ${before.occ.length} occurrences, ${before.links.length} liens acteur → ${SNAP}`)
  if (!APPLY) { console.log('\nDRY-RUN : rien écrit. --apply pour exécuter.'); return }

  sep('1. Atomisation composite Bella')
  await atomizeComposite()

  sep('2. Rematérialisation (suppr legacy → re-run D1+D2)')
  let created = 0, skipped = 0, errors = 0
  for (const r of reports) {
    await sb.from('canonical_subject_occurrence').delete().eq('source_kind', 'historical_pdf').eq('source_ref_id', r.id)
    const res = await ensureHistoricalPdfOccurrences({ runId: r.extraction_run_id!, siteId: r.site_id, siteReportId: r.id, visitDate: r.visitDate })
    created += res.created; skipped += res.skipped; errors += res.errors
  }
  console.log(`  created=${created} skipped=${skipped} errors=${errors}`)

  sep('3. Recette — témoin éclairage (en base)')
  const ecl2025 = (await occ(CS.eclairage)).filter((o) => o.source_ref_id === '68c3487e-a0f0-4932-945e-876997c364e6' && o.source_kind === 'historical_pdf')
  for (const o of ecl2025) console.log(`  éclairage | ${o.state_key} | doc=${o.effective_date} | event=${o.event_date ?? 'null'} | ${o.label.slice(0, 40)}`)
  const hasRealise = ecl2025.some((o) => o.state_key === 'knowledge_fact' && o.event_date === '2024-03-22')
  const hasARefaire = ecl2025.some((o) => o.state_key === 'action' && !o.event_date)

  sep('4. Recette — autres sujets')
  const checks: { n: string; ok: boolean; d: string }[] = []
  checks.push({ n: 'éclairage RÉALISÉ (event 2024-03-22, source PV 2025)', ok: hasRealise, d: `${ecl2025.length} occ 2025` })
  checks.push({ n: 'éclairage À REFAIRE (event null, doc 2025)', ok: hasARefaire, d: '' })
  const cuisson = await occ(CS.cuisson)
  checks.push({ n: 'cuisson continuité 2024→2025', ok: cuisson.some((o) => o.effective_date.startsWith('2024')) && cuisson.some((o) => o.effective_date.startsWith('2025')), d: cuisson.map((o) => o.effective_date).sort().join(',') })
  const elec = await occ(CS.elec)
  checks.push({ n: 'électrique : Fait 2024 (event 2024-03-22) + à refaire', ok: elec.some((o) => o.event_date === '2024-03-22') && elec.some((o) => o.state_key === 'action'), d: `${elec.length} états` })
  const registre = await occ(CS.registre)
  checks.push({ n: 'registre observation 2024 toujours présent', ok: registre.length >= 1, d: `${registre.length}` })
  const { data: extProps } = await sb.from('canonical_subject').select('id, label').eq('site_id', BELLA).ilike('label', '%extincteurs%')
  const extOcc = extProps?.length ? await occ(extProps[0].id) : []
  checks.push({ n: 'extincteurs multi-états', ok: extOcc.length >= 2, d: `${extOcc.length}` })

  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.n} — ${c.d}`)
  const allOk = checks.every((c) => c.ok)

  // corpus counts + anomalies
  const { count: totalAfter } = await sb.from('canonical_subject_occurrence').select('id', { count: 'exact', head: true }).eq('source_kind', 'historical_pdf')
  const { count: evFilled } = await sb.from('canonical_subject_occurrence').select('id', { count: 'exact', head: true }).eq('source_kind', 'historical_pdf').not('event_date', 'is', null)
  sep('5. Corpus')
  console.log(`  occurrences historical_pdf : ${before.occ.length} → ${totalAfter} | event_date renseignées : ${evFilled}`)

  if (!allOk) { console.log('\n❌ Recette échouée → ROLLBACK'); await rollback(); process.exit(1) }
  sep('✅ BACKFILL A VALIDÉ — la connaissance correcte est représentable en base (modèle occurrence).')
  console.log('Rollback disponible : npx tsx --env-file=.env.local scripts/backfill-a-execute.ts --rollback')
}

main().catch((e) => { console.error(e); process.exit(1) })
