import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmbedding, getActiveProvider } from './embeddings'

export interface KnowledgeChunkMatch {
  sourceDomain: 'library' | 'tender_history'
  sourceType: string
  sourceId: string
  chunkText: string
  metadata: Record<string, unknown>
}

export interface KnowledgeMatchBySource {
  sourceDomain: 'library' | 'tender_history'
  sourceId: string
  label: string
  chunks: KnowledgeChunkMatch[]
}

type RawKnowledgeMatch = {
  source_domain: string
  source_type: string
  source_id: string
  chunk_index: number
  chunk_text: string
  metadata: Record<string, unknown>
  similarity: number
}

async function getTenantId(): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('sites').select('tenant_id').limit(1).maybeSingle()
  return (data as { tenant_id?: string } | null)?.tenant_id ?? null
}

function buildSourceLabel(match: RawKnowledgeMatch): string {
  const meta = match.metadata ?? {}
  if (match.source_domain === 'library') {
    return (meta.title as string | undefined) ?? 'Document bibliothèque'
  }
  const title = (meta.title as string | undefined) ?? 'AO'
  const outcome = meta.outcome === 'won' ? 'Gagné'
    : meta.outcome === 'lost' ? 'Perdu'
    : String(meta.outcome ?? '')
  const parts = [
    outcome,
    meta.client as string | undefined,
    (meta.year as number | undefined)?.toString(),
  ].filter(Boolean)
  return `${title}${parts.length > 0 ? ` (${parts.join(' — ')})` : ''}`
}

function groupBySource(matches: RawKnowledgeMatch[]): KnowledgeMatchBySource[] {
  const bySource = new Map<string, { firstMatch: RawKnowledgeMatch; chunks: KnowledgeChunkMatch[] }>()

  for (const m of matches) {
    const key = `${m.source_domain}:${m.source_id}`
    const entry = bySource.get(key) ?? { firstMatch: m, chunks: [] }
    entry.chunks.push({
      sourceDomain: m.source_domain as 'library' | 'tender_history',
      sourceType: m.source_type,
      sourceId: m.source_id,
      chunkText: m.chunk_text,
      metadata: m.metadata,
    })
    bySource.set(key, entry)
  }

  return [...bySource.values()].map(({ firstMatch, chunks }) => ({
    sourceDomain: firstMatch.source_domain as 'library' | 'tender_history',
    sourceId: firstMatch.source_id,
    label: buildSourceLabel(firstMatch),
    chunks,
  }))
}

/**
 * Matche un AO contre la mémoire documentaire du tenant (bibliothèque + AO passés).
 * Retourne [] si pas de provider embedding ou pas de texte extrait.
 */
export async function matchAoToKnowledge(tenderId: string): Promise<KnowledgeMatchBySource[]> {
  if (getActiveProvider() === null) return []

  const supabase = createAdminClient()
  const { data: doc } = await supabase
    .from('tender_documents')
    .select('extracted_text')
    .eq('tender_id', tenderId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const rawText = (doc as { extracted_text?: string } | null)?.extracted_text
  if (!rawText || rawText.length < 50) return []

  const [embedding, tenantId] = await Promise.all([
    getEmbedding(rawText.slice(0, 2000)),
    getTenantId(),
  ])
  if (!embedding || !tenantId) return []

  const { data, error } = await supabase.rpc('find_similar_knowledge_chunks', {
    p_tenant_id: tenantId,
    p_embedding: `[${embedding.join(',')}]`,
    p_source_domains: ['library', 'tender_history'],
    p_limit: 15,
    p_threshold: 0.55,
  })
  if (error) {
    console.error('[match-ao-knowledge] RPC error', JSON.stringify(error))
    return []
  }
  const matches = (data ?? []) as RawKnowledgeMatch[]
  if (matches.length === 0) return []

  return groupBySource(matches)
}
