// scripts/dev/embed-trace.ts
//
// Backfill embedding pour des notes terrain insérées via SQL brut
// (qui bypasse createSiteNote → embedAndStoreTrace).
//
// Usage :
//   npx tsx scripts/dev/embed-trace.ts <noteId1> [noteId2 ...]
//
// Idempotent : trace_embeddings a UNIQUE(source_type, source_id),
// donc ré-exécution = UPSERT.

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'
import { embedAndStoreTrace } from '@/lib/ai/embed-trace'

async function main() {
  const ids = process.argv.slice(2)
  if (ids.length === 0) {
    console.error('Usage: npx tsx scripts/dev/embed-trace.ts <noteId1> [noteId2 ...]')
    process.exit(1)
  }

  const sb = createAdminClient()
  for (const id of ids) {
    const { data: note } = await sb
      .from('site_notes')
      .select('id, site_id, body, deleted_at')
      .eq('id', id)
      .maybeSingle()
    if (!note) {
      console.log(`[embed-trace] ${id} : note introuvable`)
      continue
    }
    const n = note as { id: string; site_id: string; body: string; deleted_at: string | null }
    if (n.deleted_at) {
      console.log(`[embed-trace] ${id} : note soft-deleted, skip`)
      continue
    }
    console.log(`[embed-trace] ${id} : embedding…`)
    const ok = await embedAndStoreTrace({
      sourceType: 'site_note',
      sourceId: n.id,
      siteId: n.site_id,
      text: n.body,
    })
    console.log(`[embed-trace] ${id} : ${ok ? '✓ stocké dans trace_embeddings' : '✗ skip (pas d\'API key, texte trop court, ou erreur)'}`)
  }
}

main().catch((e) => {
  console.error('[embed-trace] erreur:', e)
  process.exit(1)
})
