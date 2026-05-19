import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmbedding, getActiveProvider } from './embeddings'
import { canViewDocument } from '@/lib/documents/access'
import type { UserRole, DocumentVisibility } from '@/types/db'

type SourceDomain = 'library' | 'tender_history' | 'document'

export interface KnowledgeChunkMatch {
  sourceDomain: SourceDomain
  sourceType: string
  sourceId: string
  chunkText: string
  metadata: Record<string, unknown>
}

export interface KnowledgeMatchBySource {
  sourceDomain: SourceDomain
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
  if (match.source_domain === 'document') {
    // Lien source conservé : [doc:id] → ré-ouvrable /documents/<id>
    // (cohérent avec A1, prompts agents). Jamais de scoring/fiche personne.
    const t = meta.document_type as string | undefined
    return `Document [doc:${match.source_id}]${t ? ` · ${t}` : ''}`
  }
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
      sourceDomain: m.source_domain as SourceDomain,
      sourceType: m.source_type,
      sourceId: m.source_id,
      chunkText: m.chunk_text,
      metadata: m.metadata,
    })
    bySource.set(key, entry)
  }

  return [...bySource.values()].map(({ firstMatch, chunks }) => ({
    sourceDomain: firstMatch.source_domain as SourceDomain,
    sourceId: firstMatch.source_id,
    label: buildSourceLabel(firstMatch),
    chunks,
  }))
}

/**
 * Matche un AO contre la mémoire documentaire du tenant : bibliothèque + AO
 * passés + documents (source_domain='document', A2).
 *
 * `role` (défaut null) borne la visibilité des chunks DOCUMENT via
 * canViewDocument : sans rôle fourni, AUCUN chunk document n'est retourné
 * (pas de fuite). library/tender_history = savoir entreprise, non concernés.
 * Retourne [] si pas de provider embedding ou pas de texte extrait.
 */
export async function matchAoToKnowledge(
  tenderId: string,
  role: UserRole | null = null,
): Promise<KnowledgeMatchBySource[]> {
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
    p_source_domains: ['library', 'tender_history', 'document'],
    p_limit: 15,
    p_threshold: 0.55,
  })
  if (error) {
    console.error('[match-ao-knowledge] RPC error', JSON.stringify(error))
    return []
  }
  const raw = (data ?? []) as RawKnowledgeMatch[]
  if (raw.length === 0) return []

  // visibility_level respecté AU RECALL : un chunk document n'est conservé
  // que si le rôle appelant peut le voir (canViewDocument). library /
  // tender_history = savoir entreprise, non filtrés. Sans rôle → 0 document.
  const matches = raw.filter((m) => {
    if (m.source_domain !== 'document') return true
    const lvl = (m.metadata?.visibility_level as DocumentVisibility) ?? 'manager'
    return canViewDocument(role, lvl)
  })
  if (matches.length === 0) return []

  return groupBySource(matches)
}
