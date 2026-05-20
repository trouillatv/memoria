// scripts/dev/diag-b2.ts
//
// Diagnostic B2 : pour un doc + site donnés, trace l'exécution chunk
// par chunk avec les valeurs cosine effectives, le verdict des filtres
// (chunkSignalsAction, traceSignalsActionable) et le top-match.
//
// Permet de savoir EXACTEMENT pourquoi B2 ne produit rien :
//   - cosine < seuil B2_COSINE_THRESHOLD (0.80) ?
//   - chunk ne passe pas chunkSignalsAction ?
//   - trace ne passe pas traceSignalsActionable ?
//   - pas de traces sur le site ?
//
// Usage :
//   npx tsx scripts/dev/diag-b2.ts <siteId> <docId>

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'
import { findSimilarTraces } from '@/lib/ai/embed-trace'
import { chunkSignalsAction, traceSignalsActionable, B2_COSINE_THRESHOLD } from '@/lib/documents/cross-store-matchers'

function parseVec(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.every((x) => typeof x === 'number') ? (raw as number[]) : null
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr as number[]
    } catch { /* ignore */ }
  }
  return null
}

async function main() {
  const [siteId, docId] = process.argv.slice(2)
  if (!siteId || !docId) {
    console.error('Usage: npx tsx scripts/dev/diag-b2.ts <siteId> <docId>')
    process.exit(1)
  }
  const sb = createAdminClient()

  const { data: chunks } = await sb
    .from('knowledge_chunks')
    .select('chunk_index, chunk_text, embedding')
    .eq('source_domain', 'document')
    .eq('source_id', docId)
    .not('embedding', 'is', null)
    .order('chunk_index', { ascending: true })

  if (!chunks || chunks.length === 0) {
    console.log('Aucun chunk avec embedding pour ce doc.')
    return
  }
  console.log(`Chunks à analyser : ${chunks.length}`)
  console.log(`Seuil cosine B2 = ${B2_COSINE_THRESHOLD}`)
  console.log('')

  let bestOverall = { sim: 0, chunkIdx: -1, traceText: '' }
  let nWouldFireAt80 = 0
  let nWouldFireAt65 = 0

  for (const c of chunks as Array<{ chunk_index: number; chunk_text: string; embedding: unknown }>) {
    const emb = parseVec(c.embedding)
    if (!emb) continue
    const action = chunkSignalsAction(c.chunk_text)
    const matches = await findSimilarTraces({ siteId, queryEmbedding: emb, limit: 1 }).catch(() => [])
    const top = matches[0]
    if (top) {
      if (top.similarity > bestOverall.sim) {
        bestOverall = { sim: top.similarity, chunkIdx: c.chunk_index, traceText: top.text_excerpt.slice(0, 60) }
      }
      if (top.similarity >= 0.80) nWouldFireAt80 += 1
      if (top.similarity >= 0.65) nWouldFireAt65 += 1
    }
    const marker = top && top.similarity >= B2_COSINE_THRESHOLD ? '★' : ' '
    const actionMark = action ? 'A' : '-'
    const sim = top?.similarity?.toFixed(3) ?? '  n/a'
    const excerpt = top?.text_excerpt?.slice(0, 50) ?? '(no match)'
    console.log(`${marker} ${actionMark} chunk #${String(c.chunk_index).padStart(2)} · cos=${sim} · ${excerpt}`)
  }

  console.log('')
  console.log(`Top similarity globale : ${bestOverall.sim.toFixed(3)} (chunk #${bestOverall.chunkIdx})`)
  console.log(`  excerpt: ${bestOverall.traceText}`)
  console.log('')
  console.log(`Chunks qui dépasseraient cosine ≥ 0.80 : ${nWouldFireAt80}`)
  console.log(`Chunks qui dépasseraient cosine ≥ 0.65 : ${nWouldFireAt65}`)
  console.log('')
  console.log('Légende : ★ = passerait B2 (cos ≥ seuil), A = chunk a signal action, - = pas de signal action')
}

main().catch(console.error)
