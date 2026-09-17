// P0-D — audit READ-ONLY : les 23 questions clarify_evidence de Centre commercial Dumbéa Mall
// contiennent-elles des doublons logiques (même document + page + extrait normalisé) ? Et existe-t-il
// des entrées dont le sujet/thread est déjà rattaché à un Point suivi (donc potentiellement obsolètes) ?
// Réutilise loadEvidenceScopeQueue (code de production réel). Aucune écriture.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '@/lib/supabase/admin'
import { loadEvidenceScopeQueue } from '@/lib/knowledge/tracked-point-evidence-scope-queue'

function normalizeExcerpt(s: string | null): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

async function main() {
  const supabase = createAdminClient()
  const { data: sites, error } = await supabase.from('sites').select('id, name').eq('name', 'Centre commercial Dumbéa Mall')
  if (error) throw error
  if (sites.length !== 1) throw new Error(`site introuvable exact : ${JSON.stringify(sites)}`)
  const site = sites[0]

  const queue = await loadEvidenceScopeQueue(site.id)
  console.log(`Site = ${site.name} [${site.id}]`)
  console.log(`entries (questions clarify_evidence) = ${queue.totalEntries}\n`)

  let totalProposals = 0
  const logicalKeyCount = new Map<string, number>()

  for (const entry of queue.entries) {
    totalProposals += entry.proposalCount
    console.log(`--- trace=${entry.pendingTraceId} kind=${entry.kind} subjectId=${entry.subjectId ?? 'null'} subjectLabel=${entry.subjectLabel ?? 'null'}`)
    console.log(`    thread=${entry.sourceThreadId} reason=${entry.reason ?? 'null'} proposals=${entry.proposalCount}`)
    for (const p of entry.proposals) {
      const key = `${p.documentId ?? 'nodoc'}|${p.sourcePage ?? 'nopage'}|${normalizeExcerpt(p.sourceExcerpt)}`
      logicalKeyCount.set(key, (logicalKeyCount.get(key) ?? 0) + 1)
      console.log(`      proposal=${p.proposalId} family=${p.family} doc=${p.documentFilename ?? 'null'} page=${p.sourcePage ?? 'null'} excerpt=${JSON.stringify((p.sourceExcerpt ?? '').slice(0, 80))}`)
    }
  }

  console.log(`\nTotal propositions (tous entries confondus) = ${totalProposals}`)
  const dupKeys = [...logicalKeyCount.entries()].filter(([, n]) => n > 1)
  console.log(`Clés logiques (document+page+extrait normalisé) apparaissant PLUSIEURS FOIS across entries = ${dupKeys.length}`)
  for (const [k, n] of dupKeys) console.log(`  x${n} : ${k}`)

  // Sujets déjà rattachés à un Point suivi (tracked_point) -> question potentiellement obsolète
  // si le Point existe déjà et que le sujet est suivi.
  const subjectIds = [...new Set(queue.entries.map((e) => e.subjectId).filter((id): id is string => !!id))]
  if (subjectIds.length > 0) {
    const { data: points, error: ptErr } = await supabase
      .from('tracked_point')
      .select('id, canonical_subject_id, status')
      .eq('site_id', site.id)
      .in('canonical_subject_id', subjectIds)
    if (ptErr) throw ptErr
    console.log(`\nSujets référencés par les 23 questions = ${subjectIds.length}`)
    console.log(`Dont déjà propriétaires d'au moins un tracked_point existant (tous statuts) = ${new Set((points ?? []).map((p) => p.canonical_subject_id)).size}`)
    for (const p of points ?? []) console.log(`  subject=${p.canonical_subject_id} → point=${p.id} status=${p.status}`)
  } else {
    console.log('\nAucune des 23 questions ne porte de subjectId (thread jamais résolu à un sujet).')
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
