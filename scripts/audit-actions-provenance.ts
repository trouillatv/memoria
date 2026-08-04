// Audit provenance des 52 actions OCEF Compostage
// Objectif : identifier le pipeline de création (pourquoi report_id = null mais subject_thread_id renseigné)

import { createAdminClient } from '../lib/supabase/admin'

const sb = createAdminClient()
const SITE_ID = '2c939e67-e986-4635-86a0-638cda870480' // OCEF Compostage

async function main() {
  console.log('=== Audit provenance — OCEF Compostage ===\n')

  // 1. Toutes les actions du site avec tous les champs utiles
  const { data: actions } = await sb
    .from('site_actions')
    .select('id, title, status, report_id, created_at, created_from, created_by, due_date')
    .eq('site_id', SITE_ID)
    .order('created_at', { ascending: true })

  const total = actions?.length ?? 0
  console.log(`Total actions : ${total}`)

  // Distribution created_from
  const fromCounts = new Map<string, number>()
  for (const a of actions ?? []) {
    const key = a.created_from ?? '(null)'
    fromCounts.set(key, (fromCounts.get(key) ?? 0) + 1)
  }
  console.log('\ncreated_from :')
  for (const [k, n] of fromCounts) console.log(`  ${k.padEnd(25)} : ${n}`)

  // Distribution report_id null vs renseigné
  const withReport = (actions ?? []).filter(a => a.report_id).length
  console.log(`\nreport_id renseigné : ${withReport} / ${total}`)

  // 2. Pour chaque action, remonter la chaîne : action → mat → proposal → run → document
  const actionIds = (actions ?? []).map(a => a.id)

  const matRows: Array<{ target_entity_id: string; proposal_id: string; created_at: string }> = []
  for (let i = 0; i < actionIds.length; i += 100) {
    const { data } = await sb
      .from('document_proposal_materialization')
      .select('target_entity_id, proposal_id, created_at')
      .eq('target_entity_type', 'site_action')
      .in('target_entity_id', actionIds.slice(i, i + 100))
    matRows.push(...(data ?? []))
  }
  console.log(`\nEntrées document_proposal_materialization : ${matRows.length}`)

  const propIds = matRows.map(m => m.proposal_id)
  const propRows: Array<{
    id: string
    subject_thread_id: string | null
    extraction_run_id: string
    proposal_family: string
    review_status: string | null
    label: string
  }> = []
  for (let i = 0; i < propIds.length; i += 100) {
    const { data } = await sb
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, extraction_run_id, proposal_family, review_status, label')
      .in('id', propIds.slice(i, i + 100))
    propRows.push(...(data ?? []))
  }

  // Distribution review_status des propositions
  const reviewCounts = new Map<string, number>()
  for (const p of propRows) {
    const k = p.review_status ?? '(null)'
    reviewCounts.set(k, (reviewCounts.get(k) ?? 0) + 1)
  }
  console.log('\nreview_status des propositions source :')
  for (const [k, n] of reviewCounts) console.log(`  ${k.padEnd(25)} : ${n}`)

  // Runs uniques impliqués
  const runIds = new Set(propRows.map(p => p.extraction_run_id))
  console.log(`\nRuns d'extraction impliqués : ${runIds.size}`)

  if (runIds.size > 0) {
    const { data: runs } = await sb
      .from('document_extraction_run')
      .select('id, status, created_at, is_canonical')
      .in('id', [...runIds])
      .order('created_at', { ascending: true })

    console.log('\nDétail des runs :')
    for (const r of runs ?? []) {
      const rr = r as { id: string; status: string; created_at: string; is_canonical: boolean }
      console.log(`  ${rr.id.slice(0,8)}... | status=${rr.status} | canonical=${rr.is_canonical} | ${rr.created_at.slice(0,10)}`)
    }

    // Est-ce que ces runs ont un site_report associé ?
    const { data: reports } = await sb
      .from('site_reports')
      .select('id, extraction_run_id, origin, status')
      .in('extraction_run_id', [...runIds])

    console.log(`\nsite_reports associés à ces runs : ${reports?.length ?? 0}`)
    for (const r of reports ?? []) {
      const rr = r as { id: string; extraction_run_id: string; origin: string; status: string }
      console.log(`  report ${rr.id.slice(0,8)}... | run=${rr.extraction_run_id?.slice(0,8)}... | origin=${rr.origin} | status=${rr.status}`)
    }
  }

  // 3. Fenêtre temporelle de création des actions
  if (actions && actions.length > 0) {
    const sorted = [...actions].sort((a, b) => a.created_at.localeCompare(b.created_at))
    console.log(`\nFenêtre de création :`)
    console.log(`  Première : ${sorted[0].created_at.slice(0,10)} — ${sorted[0].title?.slice(0,50)}`)
    console.log(`  Dernière : ${sorted[sorted.length-1].created_at.slice(0,10)} — ${sorted[sorted.length-1].title?.slice(0,50)}`)

    // Grouper par date
    const byDate = new Map<string, number>()
    for (const a of actions) {
      const d = a.created_at.slice(0,10)
      byDate.set(d, (byDate.get(d) ?? 0) + 1)
    }
    console.log('\nRépartition par date de création :')
    for (const [d, n] of [...byDate.entries()].sort()) {
      console.log(`  ${d} : ${n} action${n>1?'s':''}`)
    }
  }
}

main().catch(console.error)
