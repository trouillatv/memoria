-- Migration 060 — knowledge_chunks : mémoire sémantique bibliothèque + historique AO (2026-05-16)
--
-- Doctrine V5.1.4 :
--   "L'IA est un révélateur du réel, pas un générateur de texte."
--   Les chunks permettent de retrouver des fragments pertinents dans la
--   bibliothèque AGP et dans les AO passés gagnés/perdus, pour alimenter
--   l'Atelier IA avec des preuves documentaires réelles.
--
-- Deux domaines :
--   'library'        — sections de knowledge_items (procédures, certifications…)
--   'tender_history' — documents d'AO gagnés ou perdus

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  source_domain text        NOT NULL CHECK (source_domain IN ('library', 'tender_history')),
  source_type   text        NOT NULL,   -- 'knowledge_item' | 'tender_document'
  source_id     uuid        NOT NULL,   -- id de l'item ou du tender
  chunk_index   int         NOT NULL DEFAULT 0,
  chunk_text    text        NOT NULL,
  embedding     vector(768),            -- null tant que pas d'API key
  metadata      jsonb       DEFAULT '{}'::jsonb,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (source_domain, source_id, chunk_index)
);

-- Index par tenant (filtre obligatoire dans la RPC)
CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_idx
  ON public.knowledge_chunks (tenant_id);

-- Index ivfflat pour cosine similarity — ne couvre que les lignes avec embedding
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON public.knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE embedding IS NOT NULL;

-- RLS : service_role uniquement — jamais accessible directement depuis le client
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.knowledge_chunks IS
  'Mémoire sémantique bibliothèque + historique AO. '
  'Alimentée automatiquement à la création d''items et à la clôture d''AO (won/lost). '
  'Requêtes via find_similar_knowledge_chunks() — jamais directement depuis le client.';

-- RPC de recherche cosine cross-domaine pour un tenant.
-- Utilise la forme distance (indexable) plutôt que similarity calculée.
-- threshold 0.55 → distance_max = 0.90 (plus permissif que terrain 0.60 car
-- les documents bibliothèque sont plus abstraits que les traces terrain).
CREATE OR REPLACE FUNCTION public.find_similar_knowledge_chunks(
  p_tenant_id      uuid,
  p_embedding      vector(768),
  p_source_domains text[]  DEFAULT ARRAY['library', 'tender_history'],
  p_limit          int     DEFAULT 10,
  p_threshold      float8  DEFAULT 0.55
)
RETURNS TABLE (
  source_domain text,
  source_type   text,
  source_id     uuid,
  chunk_index   int,
  chunk_text    text,
  metadata      jsonb,
  similarity    float8
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    kc.source_domain,
    kc.source_type,
    kc.source_id,
    kc.chunk_index,
    kc.chunk_text,
    kc.metadata,
    1.0 - (kc.embedding <=> p_embedding) / 2.0 AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.tenant_id = p_tenant_id
    AND kc.source_domain = ANY(p_source_domains)
    AND kc.embedding IS NOT NULL
    AND kc.embedding <=> p_embedding <= 2.0 * (1.0 - p_threshold)
  ORDER BY kc.embedding <=> p_embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.find_similar_knowledge_chunks IS
  'Atelier IA — Recherche cosine dans la mémoire documentaire (bibliothèque + AO passés). '
  'Ne retourne jamais le vecteur. Utilisé par matchAoToKnowledge() côté serveur.';
