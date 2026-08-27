-- Migration 365 : R-1 — provenance + classification du fait sur l'occurrence
--
-- Convergence R-1 : canonical_subject_occurrence doit être la source longitudinale SUFFISANTE.
-- Deux métadonnées manquaient encore, consommées par les surfaces (fiche sujet, thread, import) :
--
--   - source_page       : provenance du fait (numéro de page du PV). Propre au fait → occurrence.
--   - thematic_category : classification du fait. Audit READ-ONLY : INSTABLE au niveau sujet
--     (34/134 sujets multi-catégories ; un sujet-lot accumule progress/forecast/test_control/…).
--     Donc propriété du FAIT, pas du sujet durable → portée par l'occurrence (jamais sur canonical_subject).
--
-- Renseignées à l'écriture par ensureHistoricalPdfOccurrences, au niveau du groupe state_key :
--   - source_page = plus petite page des propositions du groupe (première mention) ;
--   - thematic_category = catégorie univoque du groupe, sinon dominante déterministe (conflit journalisé),
--     NULL si aucune catégorie.
--
-- Additif et sûr : nullable. NULL = legacy non backfillé (transitoire) ou aucune donnée.

ALTER TABLE public.canonical_subject_occurrence
  ADD COLUMN IF NOT EXISTS source_page INTEGER;

ALTER TABLE public.canonical_subject_occurrence
  ADD COLUMN IF NOT EXISTS thematic_category TEXT;

COMMENT ON COLUMN public.canonical_subject_occurrence.source_page IS
  'R-1 — page du PV où le fait est mentionné (provenance du fait). Groupe poolé → plus petite page.';
COMMENT ON COLUMN public.canonical_subject_occurrence.thematic_category IS
  'R-1 — classification thématique du FAIT (instable au niveau sujet, cf. audit). Dominante déterministe '
  'du groupe state_key si plusieurs ; NULL si aucune. Jamais dérivée du canonical_subject.';
