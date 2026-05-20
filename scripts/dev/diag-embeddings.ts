// scripts/dev/diag-embeddings.ts
//
// Diagnostic direct du provider d'embeddings actif. Imprime :
//  - quelle clé API est détectée
//  - si un appel embedding renvoie un vecteur ou null
//  - taille du vecteur si réussi (768 attendu pour Google text-embedding-004)
//
// Usage : npx tsx scripts/dev/diag-embeddings.ts
//
// Pas de DB, pas de Supabase, pas de side effect. Juste le provider IA.

import { getActiveProvider, getEmbedding } from '@/lib/ai/embeddings'

async function main() {
  console.log('--- Diagnostic embeddings ---')
  console.log('process.env.GOOGLE_GENAI_API_KEY:',
    process.env.GOOGLE_GENAI_API_KEY ? `défini (${process.env.GOOGLE_GENAI_API_KEY.slice(0, 6)}…)` : 'NON DÉFINI')
  console.log('process.env.OPENAI_API_KEY:',
    process.env.OPENAI_API_KEY ? `défini (${process.env.OPENAI_API_KEY.slice(0, 6)}…)` : 'NON DÉFINI')
  console.log('process.env.VOYAGE_API_KEY:',
    process.env.VOYAGE_API_KEY ? `défini (${process.env.VOYAGE_API_KEY.slice(0, 6)}…)` : 'NON DÉFINI')

  const provider = getActiveProvider()
  console.log('\ngetActiveProvider():', provider)

  if (provider === null) {
    console.log('\n✗ Pas de provider actif → embedDocumentChunks retourne early, aucun chunk créé.')
    console.log('  Fix : ajouter GOOGLE_GENAI_API_KEY dans .env.local puis restart `npm run dev`.')
    return
  }

  console.log('\nTest d\'appel embedding sur un texte court…')
  const t0 = Date.now()
  const vec = await getEmbedding('Procédure de nettoyage des couloirs après pluie.')
  const dt = Date.now() - t0
  if (!vec) {
    console.log(`✗ getEmbedding a renvoyé null en ${dt}ms.`)
    console.log('  Cause probable : quota Gemini épuisé, API down, ou clé invalide.')
    console.log('  Regarde la sortie de `npm run dev` pour des lignes [embeddings/google].')
    return
  }
  console.log(`✓ Embedding obtenu en ${dt}ms — dim=${vec.length} (768 attendu pour Google).`)
  console.log(`  Premiers floats : [${vec.slice(0, 5).map((x) => x.toFixed(4)).join(', ')}, …]`)
}

main().catch((e) => {
  console.error('[diag-embeddings] erreur:', e)
  process.exit(1)
})
