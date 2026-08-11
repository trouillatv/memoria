-- Entity provenance plumbing.
--
-- Fait traverser les identifiants d'entités déjà résolus (personnes/sociétés)
-- depuis la reconnaissance sémantique jusqu'à l'occurrence canonique.
--
-- Invariant absolu :
--   label / note restent des snapshots historiques capturés à la date de la source.
--   Un renommage d'entité ne réécrit jamais ces champs.
--   Le nom courant est toujours résolu via entity_ids → site_knowledge_entities.
--
-- Chaîne cible :
--   buildDebriefSemanticMemory() → semantic_memory.resolutions[text].entityId
--     → site_knowledge_proposals.entity_ids
--       → canonical_subject_occurrence.entity_ids
--
-- Requête inverse (zéro grep textuel) :
--   SELECT DISTINCT canonical_subject_id
--   FROM canonical_subject_occurrence
--   WHERE entity_ids @> ARRAY['<uuid>']::uuid[]

ALTER TABLE public.site_knowledge_proposals
  ADD COLUMN IF NOT EXISTS entity_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.canonical_subject_occurrence
  ADD COLUMN IF NOT EXISTS entity_ids uuid[] NOT NULL DEFAULT '{}';

-- Index GIN pour les requêtes de propagation inverse (entity_id → occurrences)
CREATE INDEX IF NOT EXISTS idx_cso_entity_ids
  ON public.canonical_subject_occurrence USING GIN (entity_ids);

CREATE INDEX IF NOT EXISTS idx_skp_entity_ids
  ON public.site_knowledge_proposals USING GIN (entity_ids);
