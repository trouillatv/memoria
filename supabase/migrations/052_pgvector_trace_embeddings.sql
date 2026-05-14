-- V1.5 — Préparation embeddings (Vincent 2026-05-15).
--
-- Crée l'infrastructure pgvector + table trace_embeddings.
-- N'ACTIVE PAS la couche : aucun trigger, aucun backfill automatique.
-- Le code applicatif continue de tourner en V1 (regex / token overlap) tant
-- qu'aucune clé API embeddings (OPENAI_API_KEY ou VOYAGE_API_KEY) n'est définie.
--
-- Doctrine V5.1.4 :
--   "L'IA est un révélateur du réel, pas un générateur de texte."
--   V1 = règles déterministes. V1.5 = embeddings pour détecter les voisinages
--   sémantiques faibles (humidité ↔ moisissure, robinet ↔ fuite).
--   LLM = jamais avant V2, jamais comme couche de vérité.

CREATE EXTENSION IF NOT EXISTS vector;

-- Table de stockage des embeddings de traces textuelles.
-- source_type = quelle table d'origine, source_id = id dans cette table.
-- Le site_id est dupliqué pour requêtes cosine rapides scopées par site.
CREATE TABLE IF NOT EXISTS trace_embeddings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type   text NOT NULL CHECK (source_type IN (
    'photo_caption',
    'anomaly',
    'site_note',
    'intervention_note'
  )),
  source_id     uuid NOT NULL,
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  -- 1536 = dimension OpenAI text-embedding-3-small. Cohérent avec Voyage v3
  -- (qui sort aussi en 1024 mais on garde 1536 pour permettre OpenAI direct).
  embedding     vector(1536) NOT NULL,
  text_excerpt  text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (source_type, source_id)
);

-- Index sur site_id pour scoper les recherches cosine par site (cas usage
-- principal : "donne-moi les traces sémantiquement proches de X sur ce site").
CREATE INDEX IF NOT EXISTS trace_embeddings_site_id_idx
  ON trace_embeddings (site_id);

-- Index ivfflat pour cosine similarity. Lists = sqrt(N_rows) idéalement, on
-- met 100 pour démarrer (recalculable avec REINDEX quand le volume grossit).
CREATE INDEX IF NOT EXISTS trace_embeddings_embedding_idx
  ON trace_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- RLS : aucun accès direct depuis le client. La table sert uniquement aux
-- helpers serveur (createAdminClient via service_role).
ALTER TABLE trace_embeddings ENABLE ROW LEVEL SECURITY;

-- Aucune policy → seul service_role peut écrire/lire. Cohérent avec la
-- couche IA qui ne doit JAMAIS être manipulée côté client.

COMMENT ON TABLE trace_embeddings IS
  'V1.5 — Embeddings vectoriels des traces textuelles (captions photos, anomalies, notes). Non-activé tant que OPENAI_API_KEY ou VOYAGE_API_KEY ne sont pas définies.';

-- RPC : recherche cosinus scopée par site, avec exclusion optionnelle d'un
-- source_id (utile pour ne pas matcher une trace contre elle-même).
-- Retourne similarity ∈ [0, 1] : 1 = identique, 0 = orthogonal.
DROP FUNCTION IF EXISTS find_similar_traces(uuid, vector, uuid, int);
CREATE OR REPLACE FUNCTION find_similar_traces(
  p_site_id uuid,
  p_query_embedding vector(1536),
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
    -- Cosine distance <=> retourne [0, 2]. similarity = 1 - dist/2 ∈ [0, 1].
    1 - (te.embedding <=> p_query_embedding) / 2 AS similarity
  FROM trace_embeddings te
  WHERE te.site_id = p_site_id
    AND (p_exclude_source_id IS NULL OR te.source_id <> p_exclude_source_id)
  ORDER BY te.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION find_similar_traces IS
  'V1.5 — Recherche cosine sur trace_embeddings, scopée par site. Utilisée par lib/ai/embed-trace.ts findSimilarTraces() pour détecter les voisinages sémantiques faibles (humidité ↔ moisissure).';
