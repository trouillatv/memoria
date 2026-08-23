// SENTINEL LECTURE SEULE — PRODUCT-CANONICAL-BRIDGE (PETRO).
// Rejoue exactement le read-model de la page Actions (readSiteActionSummaries +
// groupActionsByThread) et affiche le lien canonique que la carte exposera.
// AUCUNE ÉCRITURE. AUCUN RAPPROCHEMENT CALCULÉ.

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '../lib/supabase/admin'
import { readSiteActionSummaries, groupActionsByThread } from '../lib/knowledge/repository'

const SITE = '75bd3d23-d515-46bd-8de8-254495a5bade' // Lycée PETRO ATTITI

async function main() {
  const db = createAdminClient()

  const rows = await readSiteActionSummaries(SITE)
  const open = rows.filter((a) => a.status === 'open' || a.status === 'planned')
  const groups = groupActionsByThread(open)

  console.log(`=== CARTES ACTIONS OUVERTES (${groups.length} cartes / ${open.length} lignes DB) ===\n`)

  const csIds = new Set<string>()
  for (const g of groups) {
    const href = g.canonicalSubjectId
      ? `/sites/${SITE}/historique/sujets/${g.canonicalSubjectId}`
      : null
    if (g.canonicalSubjectId) csIds.add(g.canonicalSubjectId)
    console.log(`- ${g.representative.title}`)
    console.log(`    thread=${g.representative.subject_thread_id ?? 'null'}  occurrences=${g.count}`)
    console.log(`    lien   = ${href ?? 'AUCUN (pas de FK → carte inchangée)'}`)
  }

  console.log(`\n=== SUJETS CANONIQUES CIBLÉS (${csIds.size}) ===\n`)
  for (const id of csIds) {
    const { data: cs, error: csErr } = await db
      .from('canonical_subject')
      .select('id, label, status, aliases')
      .eq('id', id)
      .maybeSingle()
    if (csErr) {
      console.error(`  ERREUR lecture CS ${id}:`, csErr.message)
      continue
    }
    const { count, error: occErr } = await db
      .from('canonical_subject_occurrence')
      .select('id', { count: 'exact', head: true })
      .eq('canonical_subject_id', id)
    if (occErr) console.error(`  ERREUR occurrences ${id}:`, occErr.message)
    console.log(`  ${id}`)
    console.log(`    label   : ${cs?.label ?? 'INTROUVABLE'}`)
    console.log(`    status  : ${cs?.status ?? '-'}  aliases=${(cs?.aliases ?? []).length}`)
    console.log(`    occurr. : ${count ?? '?'}`)
  }

  // Contrôle du gate : aucune carte ne doit exposer un lien sans FK réelle.
  const dbFk = new Map(open.map((a) => [a.id, a.canonical_subject_id]))
  const invented = groups.filter(
    (g) => g.canonicalSubjectId && !open.some((a) => a.canonical_subject_id === g.canonicalSubjectId),
  )
  console.log(`\n=== GATE ===`)
  console.log(`lignes DB portant une FK : ${[...dbFk.values()].filter(Boolean).length}/${open.length}`)
  console.log(`cartes avec lien         : ${groups.filter((g) => g.canonicalSubjectId).length}`)
  console.log(`liens inventés           : ${invented.length} ${invented.length === 0 ? '✅' : '❌'}`)
  console.log(`cartes vs lignes ouvertes: ${groups.length} vs ${open.length} (aucune action supprimée si égal ou fusion par thread)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
