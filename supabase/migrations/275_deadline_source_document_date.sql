-- Migration 275 — Provenance documentaire des échéances historiques
--
-- Problème : une échéance matérialisée depuis un PV historique du 12 février
-- affiche « Échéance ajoutée · 02 août » (date d'import MemorIA).
-- La date qui compte pour le chantier est la date du PV source.
--
-- Solution :
--   1. Ajouter source_document_effective_date sur site_deadlines.
--   2. Backfill via la chaîne de matérialisation.
--   3. Trigger après INSERT sur document_proposal_materialization
--      pour renseigner la colonne dès la création future.

-- ── 1. Colonne ────────────────────────────────────────────────────────────────

ALTER TABLE public.site_deadlines
  ADD COLUMN IF NOT EXISTS source_document_effective_date date;

-- ── 2. Backfill (données existantes) ─────────────────────────────────────────

UPDATE public.site_deadlines sd
SET source_document_effective_date = d.effective_date::date
FROM public.document_proposal_materialization dpm
JOIN public.document_extraction_proposal dep ON dep.id = dpm.proposal_id
JOIN public.document_extraction_run der ON der.id = dep.extraction_run_id
JOIN public.documents d ON d.id = der.document_id
WHERE dpm.target_entity_type = 'site_deadline'
  AND dpm.target_entity_id = sd.id
  AND d.effective_date IS NOT NULL;

-- ── 3. Trigger — propagation automatique lors de la matérialisation future ───

CREATE OR REPLACE FUNCTION public.propagate_source_date_to_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.target_entity_type = 'site_deadline' THEN
    UPDATE public.site_deadlines sd
    SET source_document_effective_date = d.effective_date::date
    FROM public.document_extraction_proposal dep
    JOIN public.document_extraction_run der ON der.id = dep.extraction_run_id
    JOIN public.documents d ON d.id = der.document_id
    WHERE dep.id = NEW.proposal_id
      AND sd.id = NEW.target_entity_id
      AND d.effective_date IS NOT NULL
      AND sd.source_document_effective_date IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_materialization_set_deadline_source_date
  ON public.document_proposal_materialization;

CREATE TRIGGER after_materialization_set_deadline_source_date
  AFTER INSERT ON public.document_proposal_materialization
  FOR EACH ROW
  EXECUTE FUNCTION public.propagate_source_date_to_deadline();
