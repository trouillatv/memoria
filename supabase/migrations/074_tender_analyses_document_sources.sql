-- Migration 074 — A6 : traçabilité des sources documentaires d'une analyse AO
--
-- Persiste les références [doc:id] RÉELLEMENT utilisées par le recall A3
-- (buildDocumentContext, calculé 1× dans orchestrator.analyzeTender). Permet
-- à l'analyse IA d'être traçable et ré-ouvrable (/documents/<id>) sans
-- nouveau recall, sans stocker de texte/extracted_text.
--
-- Additive, idempotente, non destructive (discipline 071-073). jsonb : un
-- tableau de { id, type } (références uniquement, dédupliqué par id).

ALTER TABLE public.tender_analyses
  ADD COLUMN IF NOT EXISTS document_sources jsonb;

COMMENT ON COLUMN public.tender_analyses.document_sources IS
  'A6 — sources documentaires utilisées par le recall A3 (orchestrator). '
  'Tableau [{ id, type }] dédupliqué. Références SEULEMENT (jamais texte / '
  'extracted_text). Visibilité déjà filtrée en amont (canViewDocument). '
  'Ré-ouvrable via /documents/<id>.';
