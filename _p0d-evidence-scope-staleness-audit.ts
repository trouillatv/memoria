// P0-D — audit READ-ONLY : combien des 23 entrées clarify_evidence (Dumbéa Mall) seraient
// exclues par la MÊME règle STALE_ALREADY_TRACKED déjà implémentée et déjà en production dans
// tracked-point-pending-trackability-queue.ts (thread déjà membre actif d'un tracked_point, ou
// déjà founding_reference littéral d'un tracked_point) ? Cette règle n'existe PAS aujourd'hui
// dans tracked-point-evidence-scope-queue.ts — c'est la même vérification, reprise ici en
// lecture seule pour mesurer l'écart avant toute décision de fix. Aucune écriture.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '@/lib/supabase/admin'
import { loadEvidenceScopeQueue } from '@/lib/knowledge/tracked-point-evidence-scope-queue'

async function main() {
  const supabase = createAdminClient()
  const { data: sites, error } = await supabase.from('sites').select('id, name').eq('name', 'Centre commercial Dumbéa Mall')
  if (error) throw error
  const site = sites[0]

  const queue = await loadEvidenceScopeQueue(site.id)
  const threadIds = [...new Set(queue.entries.map((e) => e.sourceThreadId))]

  const { data: rawMembers, error: memErr } = await supabase
    .from('tracked_point_member')
    .select('subject_thread_id')
    .eq('status', 'active')
    .in('subject_thread_id', threadIds)
  if (memErr) throw memErr
  const alreadyTrackedThreadIds = new Set((rawMembers ?? []).map((m) => m.subject_thread_id))

  const { data: rawFounders, error: founderErr } = await supabase
    .from('tracked_point')
    .select('founding_reference')
    .eq('site_id', site.id)
    .in('founding_reference', threadIds)
  if (founderErr) throw founderErr
  for (const f of rawFounders ?? []) {
    if (f.founding_reference) alreadyTrackedThreadIds.add(f.founding_reference)
  }

  console.log(`entries clarify_evidence = ${queue.totalEntries}`)
  console.log(`threads distincts = ${threadIds.length}`)
  console.log(`threads STALE_ALREADY_TRACKED (même règle que trackability queue) = ${alreadyTrackedThreadIds.size}`)

  let staleEntries = 0
  for (const e of queue.entries) {
    const stale = alreadyTrackedThreadIds.has(e.sourceThreadId)
    if (stale) staleEntries += 1
    console.log(`  trace=${e.pendingTraceId} thread=${e.sourceThreadId} kind=${e.kind} STALE=${stale}`)
  }
  console.log(`\nentries clarify_evidence qui seraient exclues si on applique STALE_ALREADY_TRACKED = ${staleEntries} / ${queue.totalEntries}`)
  console.log(`entries restantes (vraies questions ouvertes) = ${queue.totalEntries - staleEntries}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
