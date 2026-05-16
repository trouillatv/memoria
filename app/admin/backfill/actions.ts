'use server'

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedKnowledgeItemChunks, embedTenderHistoryChunks } from '@/lib/ai/embed-knowledge-chunks'
import { getActiveProvider } from '@/lib/ai/embeddings'

export interface BackfillItemResult {
  processed: number
  errors: number
}

export interface BackfillResult {
  library: BackfillItemResult
  tenders: BackfillItemResult
  provider: string
}

export async function runBackfillAction(
  _prev: unknown,
  _formData: FormData,
): Promise<{ ok: true; result: BackfillResult } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user || user.role !== 'admin') return { ok: false, error: 'Accès refusé' }

  const provider = getActiveProvider()
  if (!provider) {
    return {
      ok: false,
      error: 'Aucune clé API embedding configurée (GOOGLE_GENAI_API_KEY, OPENAI_API_KEY ou VOYAGE_API_KEY)',
    }
  }

  const supabase = createAdminClient()

  // --- Bibliothèque ---
  const { data: items } = await supabase
    .from('knowledge_items')
    .select('id')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200)

  const library: BackfillItemResult = { processed: 0, errors: 0 }
  for (const item of items ?? []) {
    try {
      await embedKnowledgeItemChunks((item as { id: string }).id)
      library.processed++
    } catch {
      library.errors++
    }
  }

  // --- AO gagnés/perdus ---
  const { data: tenders } = await supabase
    .from('tenders')
    .select('id')
    .in('outcome', ['won', 'lost'])
    .order('outcome_at', { ascending: true })
    .limit(200)

  const tenders_result: BackfillItemResult = { processed: 0, errors: 0 }
  for (const tender of tenders ?? []) {
    try {
      await embedTenderHistoryChunks((tender as { id: string }).id)
      tenders_result.processed++
    } catch {
      tenders_result.errors++
    }
  }

  return {
    ok: true,
    result: { library, tenders: tenders_result, provider },
  }
}
