/**
 * Audit stable_key — cas G3 et enrobage
 *
 * Vérifie si les 3 actions G3 et les 4 réserves d'enrobage sont
 * des objets distincts légitimes ou des matérialisations multiples
 * du même objet physique depuis des runs différents.
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/audit-stable-key-g3-enrobage.ts
 */

import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

// IDs des canonical_subjects identifiés lors de la recette
const CASES = [
  {
    label: 'Avis G3 — essais plateforme support de dalle',
    canonicalSubjectId: '714cf080-6970-40bc-87a8-a6777e90c8a5',
    siteId: '2c939e67-e986-4635-86a0-638cda870480',
    targetType: 'site_action',
  },
  {
    label: 'Épaisseurs d\'enrobage — OCEF Compostage',
    canonicalSubjectId: '4981ddb0-4fdd-4a60-a216-e18a3ad86cb7',
    siteId: '2c939e67-e986-4635-86a0-638cda870480',
    targetType: 'site_reserve',
  },
]

async function auditCase(c: typeof CASES[0]) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`${c.label}`)
  console.log('═'.repeat(60))

  // 1. Threads du canonical_subject
  const { data: identities } = await sb
    .from('subject_thread_identity')
    .select('subject_thread_id')
    .eq('canonical_subject_id', c.canonicalSubjectId)

  const threadIds = (identities ?? []).map((i) => i.subject_thread_id)
  console.log(`\nThreads : ${threadIds.length}`)

  if (!threadIds.length) { console.log('  (aucun thread)'); return }

  // 2. Proposals liées à ces threads
  const { data: proposals } = await sb
    .from('document_extraction_proposal')
    .select('id, extraction_run_id, stable_key, label, document_status, review_status, created_at')
    .in('subject_thread_id', threadIds)
    .order('created_at', { ascending: true })

  console.log(`\nProposals : ${proposals?.length ?? 0}`)
  for (const p of proposals ?? []) {
    console.log(`  [${p.review_status}] ${p.label?.slice(0, 60)}`)
    console.log(`    stable_key: ${p.stable_key ?? '(null)'}  run: ${p.extraction_run_id}`)
  }

  if (!proposals?.length) return

  // 3. Matérialisations
  const proposalIds = proposals.map((p) => p.id)
  const { data: mats } = await sb
    .from('document_proposal_materialization')
    .select('proposal_id, target_entity_type, target_entity_id, status')
    .in('proposal_id', proposalIds)
    .eq('target_entity_type', c.targetType)

  console.log(`\nMatérialisations (${c.targetType}) : ${mats?.length ?? 0}`)

  if (!mats?.length) return

  const entityIds = mats.map((m) => m.target_entity_id)

  // 4. Objets métier réels
  if (c.targetType === 'site_reserve') {
    const { data: reserves } = await sb
      .from('site_reserve')
      .select('id, label, status, issued_on, created_at')
      .in('id', entityIds)
      .order('issued_on', { ascending: true })

    console.log(`\nRéserves site_reserve :`)
    for (const r of reserves ?? []) {
      const mat = mats.find((m) => m.target_entity_id === r.id)
      const prop = proposals.find((p) => p.id === mat?.proposal_id)
      console.log(`  [${r.status}] ${r.label?.slice(0, 60)}`)
      console.log(`    issued_on: ${r.issued_on}  created_at: ${r.created_at?.slice(0, 10)}`)
      console.log(`    stable_key du proposal source: ${prop?.stable_key ?? '(null)'}`)
      console.log(`    run source: ${prop?.extraction_run_id}`)
    }

    // Dédupliquons par label normalisé pour voir les "vrais doublons"
    const labels = (reserves ?? []).map((r) => r.label?.toLowerCase().trim() ?? '')
    const uniqueLabels = new Set(labels)
    if (uniqueLabels.size < labels.length) {
      console.log(`\n  ⚠️  ${labels.length - uniqueLabels.size} doublons par label détectés`)
    } else {
      console.log(`\n  ✓ Tous les labels sont distincts (${labels.length} réserves)`)
    }

  } else if (c.targetType === 'site_action') {
    const { data: actions } = await sb
      .from('site_actions')
      .select('id, title, status, created_at')
      .in('id', entityIds)
      .order('created_at', { ascending: true })

    console.log(`\nActions site_actions :`)
    for (const a of actions ?? []) {
      const mat = mats.find((m) => m.target_entity_id === a.id)
      const prop = proposals.find((p) => p.id === mat?.proposal_id)
      console.log(`  [${a.status}] ${a.title?.slice(0, 60)}`)
      console.log(`    created_at: ${a.created_at?.slice(0, 10)}`)
      console.log(`    stable_key du proposal source: ${prop?.stable_key ?? '(null)'}`)
      console.log(`    run source: ${prop?.extraction_run_id}`)
    }

    const titles = (actions ?? []).map((a) => a.title?.toLowerCase().trim() ?? '')
    const uniqueTitles = new Set(titles)
    if (uniqueTitles.size < titles.length) {
      console.log(`\n  ⚠️  ${titles.length - uniqueTitles.size} doublons par titre détectés`)
    } else {
      console.log(`\n  ✓ Tous les titres sont distincts (${titles.length} actions)`)
    }
  }

  // 5. Distributions des runs sources
  const runIds = [...new Set(proposals.map((p) => p.extraction_run_id))]
  console.log(`\nRuns sources : ${runIds.length} run(s) distincts`)
  for (const runId of runIds) {
    const runProposals = proposals.filter((p) => p.extraction_run_id === runId)
    const runMats = mats.filter((m) => runProposals.some((p) => p.id === m.proposal_id))
    console.log(`  run ${runId.slice(0, 8)}... → ${runProposals.length} proposal(s), ${runMats.length} matérialisation(s)`)
  }
}

async function main() {
  for (const c of CASES) {
    await auditCase(c)
  }
  console.log('\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
