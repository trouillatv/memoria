-- 260 — Lot B : modèle documentaire historique
--
-- Trois colonnes pour structurer les PV historiques :
--
-- 1. thematic_category sur document_extraction_proposal
--    Permet de classifier chaque knowledge_fact au moment de l'extraction LLM,
--    avant toute matérialisation. Source de vérité pour le rendu PDF sectionné.
--
-- 2. thematic_category sur site_knowledge_entries
--    Propagée lors de la matérialisation. Permet de grouper par thème dans le
--    read model (getVisitSummary) sans relire les propositions.
--
-- Valeurs : progress / test_control / safety_environment / resources /
--           administrative / weather / permanent_instruction / general_knowledge
--
-- Note : attendance_status (présence par CR) est lu directement depuis
-- document_extraction_proposal.source_payload pour les visites historiques —
-- pas besoin de colonne supplémentaire pour Lot B.

ALTER TABLE public.document_extraction_proposal
  ADD COLUMN IF NOT EXISTS thematic_category TEXT;

ALTER TABLE public.site_knowledge_entries
  ADD COLUMN IF NOT EXISTS thematic_category TEXT;

-- Index pour requêter efficacement par thème depuis le read model
CREATE INDEX IF NOT EXISTS ske_thematic_category_idx
  ON public.site_knowledge_entries (site_id, thematic_category)
  WHERE deleted_at IS NULL AND thematic_category IS NOT NULL;
