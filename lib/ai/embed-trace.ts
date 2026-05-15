// V1.5 — Helpers pour calculer et stocker les embeddings de traces (Vincent 2026-05-15).
//
// Idempotent : la table `trace_embeddings` a `UNIQUE (source_type, source_id)`.
// On utilise UPSERT côté SQL pour ne jamais dupliquer.
//
// Non appelé automatiquement — à activer manuellement (backfill ou trigger
// futur) une fois la clé API embeddings définie.

import { createAdminClient } from '@/lib/supabase/admin'
import { getEmbedding, getActiveProvider } from './embeddings'

type SourceType = 'photo_caption' | 'anomaly' | 'site_note' | 'intervention_note'

/**
 * Calcule et upserte un embedding pour une trace donnée.
 * Retourne true si l'embedding a été stocké, false si skip (texte trop court,
 * pas de clé API, ou erreur silencieuse).
 */
export async function embedAndStoreTrace(params: {
  sourceType: SourceType
  sourceId: string
  siteId: string
  text: string
}): Promise<boolean> {
  if (getActiveProvider() === null) return false

  const embedding = await getEmbedding(params.text)
  if (!embedding) return false

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('trace_embeddings')
    .upsert(
      {
        source_type: params.sourceType,
        source_id: params.sourceId,
        site_id: params.siteId,
        embedding,
        text_excerpt: params.text.slice(0, 500),
      },
      { onConflict: 'source_type,source_id' },
    )

  if (error) {
    console.error('[embed-trace] upsert failed', error)
    return false
  }
  return true
}

/**
 * Helper spécifique anomalies : résout intervention → mission → site_id
 * puis upserte l'embedding. Conçu pour être appelé en fire-and-forget
 * depuis createAnomaly (lib/db/interventions.ts). Silencieux si pas de clé API.
 */
export async function embedAnomalyTrace(params: {
  anomalyId: string
  interventionId: string
  text: string
}): Promise<void> {
  if (getActiveProvider() === null) return

  try {
    const supabase = createAdminClient()

    const { data: intervention } = await supabase
      .from('interventions')
      .select('mission_id')
      .eq('id', params.interventionId)
      .maybeSingle()
    if (!intervention?.mission_id) return

    const { data: mission } = await supabase
      .from('missions')
      .select('site_id')
      .eq('id', (intervention as { mission_id: string }).mission_id)
      .maybeSingle()
    if (!(mission as { site_id?: string } | null)?.site_id) return

    await embedAndStoreTrace({
      sourceType: 'anomaly',
      sourceId: params.anomalyId,
      siteId: (mission as { site_id: string }).site_id,
      text: params.text,
    })
  } catch (e) {
    console.warn('[embed-trace] embedAnomalyTrace silently failed:', e)
  }
}

/**
 * Recherche les traces sémantiquement proches d'une trace cible, scopée
 * à un site. Retourne les top N matches par similarité cosinus.
 *
 * Utilisation prévue (V1.5) : reformuler `getSiteReadings.getResonances`
 * pour matcher consigne ↔ anomalie via embeddings au lieu de token overlap.
 */
export async function findSimilarTraces(params: {
  siteId: string
  queryEmbedding: number[]
  excludeSourceId?: string
  limit?: number
}): Promise<Array<{
  source_type: SourceType
  source_id: string
  text_excerpt: string
  similarity: number
}>> {
  const supabase = createAdminClient()
  // pgvector cosine distance operator <=> donne 0 = identique, 2 = opposé.
  // similarity = 1 - distance / 2 pour ramener entre 0 et 1.
  const { data, error } = await supabase.rpc('find_similar_traces', {
    p_site_id: params.siteId,
    p_query_embedding: params.queryEmbedding,
    p_exclude_source_id: params.excludeSourceId ?? null,
    p_limit: params.limit ?? 5,
  })

  if (error) {
    console.error('[embed-trace] find_similar_traces failed', error)
    return []
  }

  return (data ?? []) as Array<{
    source_type: SourceType
    source_id: string
    text_excerpt: string
    similarity: number
  }>
}
