// Rollback d'une ou plusieurs fusions PETRO ATITI.
// Lit scripts/petro-merge-snapshots.json et restaure l'état pré-merge.
//
// Usage :
//   npx tsx scripts/merge-petro-rollback.ts --merge merge-1-cadenas-acces [--dry-run]
//   npx tsx scripts/merge-petro-rollback.ts --merge all [--dry-run]
//
// IMPORTANT : en mode production, le rollback est irréversible à son tour.
//   Toujours faire un dry-run avant.

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { join } from 'path'

config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const DRY_RUN = process.argv.includes('--dry-run')
const MERGE_ARG = (() => {
  const idx = process.argv.indexOf('--merge')
  return idx !== -1 ? process.argv[idx + 1] : null
})()

if (!MERGE_ARG) {
  console.error('Usage : npx tsx scripts/merge-petro-rollback.ts --merge <name|all> [--dry-run]')
  process.exit(1)
}

if (DRY_RUN) console.log('\n⚠️  MODE DRY-RUN — aucune modification en base\n')

type Snapshot = {
  name: string
  capturedAt: string
  merge: {
    sourceId: string
    sourceLabel: string
    targetId: string
    targetLabel: string
    finalLabel: string
  }
  before: {
    source: { id: string; label: string; aliases: string[]; status: string; merged_into: string | null } | null
    target: { id: string; label: string; aliases: string[]; status: string } | null
    occurrenceIds: string[]
    threadIds: string[]
    proposalIds: string[]
  }
}

async function rollbackMerge(snap: Snapshot) {
  const { merge, before } = snap
  console.log(`\n── ROLLBACK : ${snap.name} ──`)
  console.log(`  Snapshot capturé le : ${snap.capturedAt}`)
  console.log(`  Source : ${merge.sourceId} (${merge.sourceLabel})`)
  console.log(`  Target : ${merge.targetId} (${merge.targetLabel})`)

  // Vérifier l'état actuel du source (doit être 'merged' pour qu'un rollback ait du sens)
  const { data: currentSrc } = await sb
    .from('canonical_subject')
    .select('status, merged_into, label')
    .eq('id', merge.sourceId)
    .single()

  if (!currentSrc) {
    console.error('  ❌ Source introuvable en base — abandon')
    return
  }
  const src = currentSrc as { status: string; merged_into: string | null; label: string }
  if (src.status !== 'merged') {
    console.warn(`  ⚠️  Source status = "${src.status}" (pas 'merged') — le rollback est peut-être déjà fait ou la fusion n'a pas eu lieu`)
  }

  console.log(`  Occurrences à rapatrier : ${before.occurrenceIds.length}`)
  console.log(`  Threads à rapatrier     : ${before.threadIds.length}`)
  console.log(`  Proposals à rapatrier   : ${before.proposalIds.length}`)

  if (DRY_RUN) {
    console.log('  [DRY-RUN] Aucune modification.')
    return
  }

  // 1. Rapatrier les occurrences vers source
  if (before.occurrenceIds.length > 0) {
    const { error } = await sb
      .from('canonical_subject_occurrence')
      .update({ canonical_subject_id: merge.sourceId })
      .in('id', before.occurrenceIds)
    if (error) { console.error(`  ❌ Erreur occurrences : ${error.message}`); return }
  }

  // 2. Rapatrier les threads vers source
  if (before.threadIds.length > 0) {
    const { error } = await sb
      .from('subject_thread_identity')
      .update({ canonical_subject_id: merge.sourceId })
      .in('subject_thread_id', before.threadIds)
    if (error) { console.error(`  ❌ Erreur threads : ${error.message}`); return }
  }

  // 3. Rapatrier les proposals vers source
  if (before.proposalIds.length > 0) {
    const { error } = await sb
      .from('site_knowledge_proposals')
      .update({ canonical_subject_id: merge.sourceId })
      .in('id', before.proposalIds)
    if (error) { console.error(`  ❌ Erreur proposals : ${error.message}`); return }
  }

  // 4. Restaurer source (status + label + aliases)
  const sourceRestore = before.source
  if (sourceRestore) {
    const { error } = await sb
      .from('canonical_subject')
      .update({
        status: 'active',
        merged_into: null,
        label: sourceRestore.label,
        aliases: sourceRestore.aliases,
      })
      .eq('id', merge.sourceId)
    if (error) { console.error(`  ❌ Erreur restore source : ${error.message}`); return }
  }

  // 5. Restaurer target (label + aliases avant merge)
  const targetRestore = before.target
  if (targetRestore) {
    const { error } = await sb
      .from('canonical_subject')
      .update({
        label: targetRestore.label,
        aliases: targetRestore.aliases,
      })
      .eq('id', merge.targetId)
    if (error) { console.error(`  ❌ Erreur restore target : ${error.message}`); return }
  }

  // 6. Supprimer le journal de merge (si présent)
  await sb
    .from('canonical_subject_merge')
    .delete()
    .eq('winner_subject_id', merge.targetId)
    .eq('loser_subject_id', merge.sourceId)

  console.log(`  ✅ Rollback effectué`)
}

async function main() {
  const snapshotPath = join(process.cwd(), 'scripts', 'petro-merge-snapshots.json')
  let snapshots: Snapshot[]
  try {
    snapshots = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as Snapshot[]
  } catch {
    console.error(`❌ Impossible de lire ${snapshotPath}`)
    console.error('   Avez-vous lancé merge-petro-snapshot.ts ?')
    process.exit(1)
  }

  console.log('=== ROLLBACK MERGE PETRO ATITI ===')
  console.log(`Snapshots disponibles : ${snapshots.map((s) => s.name).join(', ')}`)

  const toRollback = MERGE_ARG === 'all'
    ? [...snapshots].reverse()  // rollback dans l'ordre inverse
    : snapshots.filter((s) => s.name === MERGE_ARG)

  if (toRollback.length === 0) {
    console.error(`❌ Aucun snapshot trouvé pour : "${MERGE_ARG}"`)
    process.exit(1)
  }

  for (const snap of toRollback) {
    await rollbackMerge(snap)
  }

  console.log('\n=== FIN ROLLBACK ===')
}

main().catch((e) => {
  console.error('❌ ERREUR :', e.message)
  process.exit(1)
})
