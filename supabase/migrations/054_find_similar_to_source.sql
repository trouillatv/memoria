-- Migration 054 — Fonction SQL pour recherche cosine croisée entre embeddings.
--
-- Permet de trouver les traces sémantiquement proches d'une source donnée
-- (identifiée par source_id) sans rapatrier le vecteur en JS.
-- Utilisé par getSiteReadings pour les résonances V1.5 (note → anomalie)
-- et les persistances V1.5 (thèmes récurrents d'anomalies).
--
-- Doctrine V5.1.4 : l'IA rapproche, elle ne conclut pas.
-- Silencieux si pas d'embeddings — le V1 token overlap reste actif en fallback.

CREATE OR REPLACE FUNCTION find_similar_to_source(
  p_source_id  uuid,
  p_target_type text,
  p_limit      int DEFAULT 5
)
RETURNS TABLE (
  source_id    uuid,
  text_excerpt text,
  similarity   float
)
LANGUAGE sql STABLE AS $$
  SELECT
    target.source_id,
    target.text_excerpt,
    1 - (query.embedding <=> target.embedding) / 2 AS similarity
  FROM trace_embeddings query
  JOIN trace_embeddings target
    ON  target.site_id      = query.site_id
    AND target.source_type  = p_target_type
    AND target.source_id   <> query.source_id
  WHERE query.source_id = p_source_id
  ORDER BY query.embedding <=> target.embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION find_similar_to_source IS
  'V1.5 — Recherche cosine croisée entre embeddings stockés. Prend un source_id '
  'comme ancre et retourne les traces du même site avec la plus forte similarité '
  'cosinus. Utilisé pour résonances (site_note → anomaly) et persistances (anomaly → anomaly).';
