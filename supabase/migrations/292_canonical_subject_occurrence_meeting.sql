-- 292_canonical_subject_occurrence_meeting.sql
-- Étend canonical_subject_occurrence pour couvrir les réunions de chantier.
--
-- V1 (mig 291) : source_kind = 'field_visit' uniquement.
-- V2 (ce lot)  : + 'meeting' (réunion dont origin IS NULL dans site_reports).
--
-- Modèle de statut réunion : 'mentioned' — le sujet a été évoqué en réunion.
-- field_checked/still_open/not_applicable restent réservés aux visites terrain.
--
-- Discriminant réunion/visite (mig 162, doc) :
--   site_reports.origin IS NOT NULL → visite terrain (field_visit)
--   site_reports.origin IS NULL     → réunion (meeting)

-- ── source_kind : élargir à 'meeting' ─────────────────────────────────────────

ALTER TABLE canonical_subject_occurrence
  DROP CONSTRAINT IF EXISTS canonical_subject_occurrence_source_kind_check;

ALTER TABLE canonical_subject_occurrence
  ADD CONSTRAINT canonical_subject_occurrence_source_kind_check
    CHECK (source_kind IN ('field_visit', 'meeting'));

-- ── visit_status : ajouter 'mentioned' pour les réunions ──────────────────────

ALTER TABLE canonical_subject_occurrence
  DROP CONSTRAINT IF EXISTS canonical_subject_occurrence_visit_status_check;

ALTER TABLE canonical_subject_occurrence
  ADD CONSTRAINT canonical_subject_occurrence_visit_status_check
    CHECK (visit_status IS NULL OR visit_status IN (
      'field_checked',   -- visite terrain : point vérifié
      'still_open',      -- visite terrain : point toujours ouvert
      'not_applicable',  -- visite terrain : sans objet pour cette visite
      'mentioned'        -- réunion : sujet évoqué en réunion
    ));

-- Index sur source_kind pour les requêtes par provenance
CREATE INDEX IF NOT EXISTS idx_cso_source_kind
  ON canonical_subject_occurrence (site_id, source_kind, effective_date DESC);
