// scripts/dev/refire-resonances.ts
//
// Refire B1 + B2 résonances sur des documents existants, sans passer par
// `analyzeDocument` (qui re-OCR + re-embed à chaque exécution — coûteux).
//
// Utile pour :
//  - observer B2 après UPDATE manuel de visibility_level ;
//  - itérer rapidement sur les lexiques action/issue (re-fire sans re-OCR) ;
//  - re-jouer la compute après bump d'algorithm_version.
//
// Préconditions implicites (sinon B1/B2 retournent sans rien faire) :
//  - doc.analysis_status = 'ready'
//  - doc.document_type ∈ {plan_acces, securite, procedure, protocole}
//  - doc.visibility_level ∈ {operations, field}
//  - document_links target_type='site' existe
//  - knowledge_chunks pour source_domain='document' avec embeddings
//  - trace_embeddings présents sur le(s) site(s) lié(s)
//
// Usage :
//   npx tsx scripts/dev/refire-resonances.ts <docId1> [docId2 ...]
//
// Sortie : log par doc, indique si B1 et B2 ont produit ou non (le compte
// final est à lire via SQL sur site_reading_candidates).

import { computeDocResonancesForDocument } from '@/lib/documents/resonances'
import { computeDocCrossStoreResonancesForDocument } from '@/lib/documents/cross-store-resonances'

async function main() {
  const ids = process.argv.slice(2)
  if (ids.length === 0) {
    console.error('Usage: npx tsx scripts/dev/refire-resonances.ts <docId1> [docId2 ...]')
    process.exit(1)
  }

  for (const id of ids) {
    console.log(`[refire] ${id} — B1 (déterministe bigrammes)…`)
    await computeDocResonancesForDocument(id)

    console.log(`[refire] ${id} — B2 (cross-store cosine + filtres action)…`)
    await computeDocCrossStoreResonancesForDocument(id)

    console.log(`[refire] ${id} — done`)
  }

  console.log('\n→ Vérifier dans site_reading_candidates :')
  console.log("  WHERE algorithm_version LIKE 'b%_doc_%' ORDER BY generated_at DESC LIMIT 20;")
}

main().catch((e) => {
  console.error('[refire] error:', e)
  process.exit(1)
})
