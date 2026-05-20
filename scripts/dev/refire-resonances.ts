// scripts/dev/refire-resonances.ts
//
// Refire B1 + B2 résonances sur des documents existants, sans passer par
// `analyzeDocument` (qui re-OCR + re-embed à chaque exécution — coûteux).
//
// Usage :
//   npx tsx scripts/dev/refire-resonances.ts <docId1> [docId2 ...]
//
// Préconditions implicites (sinon B1/B2 retournent sans rien faire) :
//  - doc.analysis_status = 'ready'
//  - doc.document_type ∈ {plan_acces, securite, procedure, protocole}
//  - doc.visibility_level ∈ {operations, field}
//  - document_links target_type='site' existe
//  - knowledge_chunks pour source_domain='document' avec embeddings
//  - trace_embeddings présents sur le(s) site(s) lié(s)

// Charge .env.local explicitement (tsx ne le fait pas auto). Doit être
// AVANT toute import qui lit process.env / qui touche Supabase.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

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
