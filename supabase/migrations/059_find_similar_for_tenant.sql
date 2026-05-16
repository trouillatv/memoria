-- Atelier IA — Recherche cosine cross-sites pour un tenant (2026-05-16).
-- Permet de matcher un AO avec toute la mémoire terrain de l'entreprise.
--
-- Doctrine V5.1.4 : l'IA rapproche, elle ne conclut pas.
-- La similarity (internal_score) n'est jamais exposée en UI.
-- Calcul à la demande derrière Suspense — jamais bloquant.

CREATE OR REPLACE FUNCTION public.find_similar_traces_for_tenant(
  p_tenant_id    uuid,
  p_embedding    vector(768),
  p_source_types text[]  DEFAULT ARRAY['anomaly', 'site_note', 'intervention_note'],
  p_limit        int     DEFAULT 10,
  p_threshold    float8  DEFAULT 0.60
)
RETURNS TABLE (
  source_type  text,
  source_id    uuid,
  site_id      uuid,
  text_excerpt text,
  similarity   float8
)
LANGUAGE sql
STABLE
AS $$
  -- Filtre sur la distance cosine (indexable) plutôt que la similarité calculée.
  -- similarity = 1 - distance/2 ; threshold 0.60 → distance_max = 0.80.
  SELECT
    te.source_type,
    te.source_id,
    te.site_id,
    te.text_excerpt,
    1.0 - (te.embedding <=> p_embedding) / 2.0 AS similarity
  FROM public.trace_embeddings te
  JOIN public.sites s ON s.id = te.site_id
  WHERE s.tenant_id = p_tenant_id
    AND te.source_type = ANY(p_source_types)
    AND te.embedding <=> p_embedding <= 2.0 * (1.0 - p_threshold)
  ORDER BY te.embedding <=> p_embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.find_similar_traces_for_tenant IS
  'Atelier IA — Recherche cosine cross-sites par tenant_id. '
  'Matche un embedding AO contre toute la mémoire terrain de l''entreprise. '
  'Ne retourne jamais le vecteur. Utilisé par matchAoToTerrain() côté serveur.';
