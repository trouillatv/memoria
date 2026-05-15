-- Migration 053 — Passage embeddings 1536 dim (OpenAI) → 768 dim (Google text-embedding-004).
--
-- La table trace_embeddings est vide (migration 052 venait d'être appliquée,
-- aucun embedding stocké) — safe de drop/recreate la colonne.
--
-- Si on revient à OpenAI plus tard, il faudra repasser à vector(1536) et
-- relancer le backfill complet.

-- Supprime index ivfflat lié à la dimension 1536
DROP INDEX IF EXISTS trace_embeddings_embedding_idx;

-- Change la colonne embedding de vector(1536) à vector(768)
-- (la table doit être vide pour que ça passe sans USING)
ALTER TABLE trace_embeddings DROP COLUMN embedding;
ALTER TABLE trace_embeddings ADD COLUMN embedding vector(768) NOT NULL;

-- Recrée l'index ivfflat pour la nouvelle dimension
CREATE INDEX trace_embeddings_embedding_idx
  ON trace_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Met à jour la RPC find_similar_traces pour la dimension 768
DROP FUNCTION IF EXISTS find_similar_traces(uuid, vector, uuid, int);
CREATE OR REPLACE FUNCTION find_similar_traces(
  p_site_id uuid,
  p_query_embedding vector(768),
  p_exclude_source_id uuid DEFAULT NULL,
  p_limit int DEFAULT 5
)
RETURNS TABLE (
  source_type text,
  source_id uuid,
  text_excerpt text,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT
    te.source_type,
    te.source_id,
    te.text_excerpt,
    1 - (te.embedding <=> p_query_embedding) / 2 AS similarity
  FROM trace_embeddings te
  WHERE te.site_id = p_site_id
    AND (p_exclude_source_id IS NULL OR te.source_id <> p_exclude_source_id)
  ORDER BY te.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

COMMENT ON TABLE trace_embeddings IS
  'V1.5 — Embeddings 768 dim (Google text-embedding-004). Provider actif : GOOGLE_GENAI_API_KEY. Fallback OpenAI 1536 dim nécessite re-migration.';
