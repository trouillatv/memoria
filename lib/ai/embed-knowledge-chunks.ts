import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmbedding, getActiveProvider } from './embeddings'

const MAX_CHUNK_CHARS = 900
const MIN_CHUNK_CHARS = 50

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = []
  const sections = text.split(/\n\n+/)

  for (const section of sections) {
    const trimmed = section.trim()
    if (trimmed.length < MIN_CHUNK_CHARS) continue

    if (trimmed.length <= MAX_CHUNK_CHARS) {
      chunks.push(trimmed)
      continue
    }

    // Section trop longue : découper sur les fins de phrase
    const parts = trimmed.split(/(?<=[.!?])\s+/)
    let current = ''
    for (const part of parts) {
      if (current.length + part.length + 1 > MAX_CHUNK_CHARS && current.length >= MIN_CHUNK_CHARS) {
        chunks.push(current.trim())
        current = part
      } else {
        current = current ? `${current} ${part}` : part
      }
    }
    if (current.trim().length >= MIN_CHUNK_CHARS) chunks.push(current.trim())
  }

  return chunks
}

async function getOrFetchTenantId(): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('sites').select('tenant_id').limit(1).maybeSingle()
  return (data as { tenant_id?: string } | null)?.tenant_id ?? null
}

/**
 * Découpe et embède un knowledge_item en chunks.
 * Appelé en fire-and-forget après createKnowledgeItemAction.
 * Silencieux en cas d'erreur : l'item existe, les chunks sont un bonus.
 */
export async function embedKnowledgeItemChunks(itemId: string): Promise<void> {
  if (getActiveProvider() === null) return

  const supabase = createAdminClient()

  const tenantId = await getOrFetchTenantId()
  if (!tenantId) return

  const { data: item } = await supabase
    .from('knowledge_items')
    .select('id, title, category, content_markdown')
    .eq('id', itemId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!item) return

  const { title, category, content_markdown } = item as {
    title: string
    category: string
    content_markdown: string
  }

  const chunks = splitIntoChunks(content_markdown)
  if (chunks.length === 0) return

  // Reconstruction complète : supprimer les anciens chunks d'abord
  await supabase
    .from('knowledge_chunks')
    .delete()
    .eq('source_domain', 'library')
    .eq('source_id', itemId)

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(chunks[i])
    if (!embedding) continue

    const { error } = await supabase.from('knowledge_chunks').upsert(
      {
        tenant_id: tenantId,
        source_domain: 'library',
        source_type: 'knowledge_item',
        source_id: itemId,
        chunk_index: i,
        chunk_text: chunks[i],
        embedding: `[${embedding.join(',')}]`,
        metadata: { title, category },
      },
      { onConflict: 'source_domain,source_id,chunk_index' },
    )
    if (error) console.error('[embed-knowledge-chunks] library upsert error', error.message)
  }
}

/**
 * Découpe et embède le document d'un AO clos (won ou lost) en chunks.
 * Appelé en fire-and-forget depuis setTenderOutcomeAction.
 * Ne tourne que si l'outcome est 'won' ou 'lost'.
 */
export async function embedTenderHistoryChunks(tenderId: string): Promise<void> {
  if (getActiveProvider() === null) return

  const supabase = createAdminClient()

  const tenantId = await getOrFetchTenantId()
  if (!tenantId) return

  const { data: tender } = await supabase
    .from('tenders')
    .select('id, title, client_name, outcome, outcome_at')
    .eq('id', tenderId)
    .maybeSingle()
  if (!tender) return

  const t = tender as {
    id: string
    title: string
    client_name: string | null
    outcome: string | null
    outcome_at: string | null
  }
  if (!t.outcome || !['won', 'lost'].includes(t.outcome)) return

  const { data: doc } = await supabase
    .from('tender_documents')
    .select('extracted_text')
    .eq('tender_id', tenderId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const extractedText = (doc as { extracted_text?: string | null } | null)?.extracted_text
  if (!extractedText || extractedText.length < 100) return

  const chunks = splitIntoChunks(extractedText)
  if (chunks.length === 0) return

  // Reconstruction complète des chunks pour cet AO
  await supabase
    .from('knowledge_chunks')
    .delete()
    .eq('source_domain', 'tender_history')
    .eq('source_id', tenderId)

  const year = t.outcome_at
    ? new Date(t.outcome_at).getFullYear()
    : new Date().getFullYear()

  const metadata = {
    title: t.title,
    client: t.client_name ?? null,
    outcome: t.outcome,
    year,
  }

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(chunks[i])
    if (!embedding) continue

    const { error } = await supabase.from('knowledge_chunks').upsert(
      {
        tenant_id: tenantId,
        source_domain: 'tender_history',
        source_type: 'tender_document',
        source_id: tenderId,
        chunk_index: i,
        chunk_text: chunks[i],
        embedding: `[${embedding.join(',')}]`,
        metadata,
      },
      { onConflict: 'source_domain,source_id,chunk_index' },
    )
    if (error) console.error('[embed-knowledge-chunks] tender_history upsert error', error.message)
  }
}
