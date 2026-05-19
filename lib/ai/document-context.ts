import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmbedding, getActiveProvider } from './embeddings'
import { canViewDocument } from '@/lib/documents/access'
import {
  MAX_RETRIEVED_CHUNKS,
  clampChunksToBudget,
  toPromptBlock,
  type DocChunk,
} from './document-budget'
import type { UserRole, DocumentVisibility } from '@/types/db'

export {
  MAX_RETRIEVED_CHUNKS,
  MAX_CONTEXT_TOKENS,
  estimateTokens,
  clampChunksToBudget,
  toPromptBlock,
  type DocChunk,
} from './document-budget'

// ============================================================================
// Recall documentaire BORNÉ (phase 4b, spec 2026-05-19 + discipline coût IA)
// ============================================================================
//
// Réutilise STRICTEMENT le RAG existant (knowledge_chunks +
// find_similar_knowledge_chunks). Aucune infra neuve. Le document est
// embeddé UNE fois (phase 2) ; ici on ne fait QUE : 1 embedding de la
// question + 1 requête cosine bornée. JAMAIS relire un PDF, jamais injecter
// un document entier ni une collection.
//
// Garde-fous opposables (constantes + filtres) :
//  - MAX_RETRIEVED_CHUNKS : plafond dur de chunks ramenés (domaine 'document'
//    uniquement) ;
//  - MAX_CONTEXT_TOKENS  : plafond dur de tokens injectés ;
//  - visibility_level    : un appelant ne reçoit jamais un extrait au-dessus
//    de son niveau (canViewDocument), filtré au recall (pas seulement UI).

// Helpers de budget PURS : déplacés dans ./document-budget (sans
// `server-only`, donc testables hors runtime) et re-exportés ci-dessus.

async function fetchTenantId(): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('sites').select('tenant_id').limit(1).maybeSingle()
  return (data as { tenant_id?: string } | null)?.tenant_id ?? null
}

export interface DocumentContextResult {
  chunks: DocChunk[]
  truncated: boolean
  promptBlock: string
}

const EMPTY: DocumentContextResult = { chunks: [], truncated: false, promptBlock: '' }

/**
 * Recall documentaire pour une QUESTION (jamais un dump). 1 embedding +
 * 1 RPC cosine bornée à MAX_RETRIEVED_CHUNKS sur le domaine 'document',
 * filtré par visibility_level vs rôle appelant, puis tronqué au budget
 * tokens. Silencieux si pas de provider (pas de coût, pas d'erreur).
 */
export async function buildDocumentContext(input: {
  query: string
  role: UserRole | null
  tenantId?: string | null
}): Promise<DocumentContextResult> {
  if (getActiveProvider() === null) return EMPTY
  const query = input.query.trim()
  if (query.length < 3) return EMPTY

  const tenantId = input.tenantId ?? (await fetchTenantId())
  if (!tenantId) return EMPTY

  // Cap dur de la requête embeddée (cohérent matchAoToKnowledge).
  const embedding = await getEmbedding(query.slice(0, 2000))
  if (!embedding) return EMPTY

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('find_similar_knowledge_chunks', {
    p_tenant_id: tenantId,
    p_embedding: `[${embedding.join(',')}]`,
    p_source_domains: ['document'], // domaine document UNIQUEMENT
    p_limit: MAX_RETRIEVED_CHUNKS, // plafond dur
    p_threshold: 0.6,
  })
  if (error || !data) return EMPTY

  const rows = data as Array<{
    source_id: string
    chunk_text: string
    metadata: Record<string, unknown> | null
    similarity: number
  }>

  // Filtre visibilité : jamais un extrait au-dessus du niveau de l'appelant.
  const visible: DocChunk[] = rows
    .filter((r) => {
      const lvl = (r.metadata?.visibility_level as DocumentVisibility) ?? 'manager'
      return canViewDocument(input.role, lvl)
    })
    .map((r) => ({
      sourceId: r.source_id,
      text: r.chunk_text,
      similarity: r.similarity,
    }))

  const { kept, truncated } = clampChunksToBudget(visible)
  return { chunks: kept, truncated, promptBlock: toPromptBlock(kept, truncated) }
}
