-- 312_cso_temporal_reconciliation.sql
--
-- Invariant : une modification d'une source métier existante (CR/visite/réunion) doit
-- mettre à jour l'état correspondant à son effective_date, jamais créer une occurrence
-- à la date de modification informatique.
--
-- Ce que cette migration ajoute :
--   1. updated_at sur canonical_subject_occurrence — traçabilité des mises à jour
--   2. 'source_superseded' dans le CHECK de validation_status — statut pour les
--      occurrences confirmées dont la source ne mentionne plus le sujet

-- 1. Colonne updated_at (nullable — les anciennes occurrences n'ont jamais été mises à jour)
ALTER TABLE canonical_subject_occurrence
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- 2. Étendre la contrainte CHECK validation_status
-- Le nom auto-généré par PostgreSQL pour une contrainte inline est "{table}_{colonne}_check"
ALTER TABLE canonical_subject_occurrence
  DROP CONSTRAINT IF EXISTS canonical_subject_occurrence_validation_status_check;

ALTER TABLE canonical_subject_occurrence
  ADD CONSTRAINT canonical_subject_occurrence_validation_status_check
  CHECK (validation_status IN ('observed', 'confirmed', 'rejected', 'source_superseded'));

-- 3. Index partiel : exclure 'rejected' et 'source_superseded' des occurrences actives
-- L'index existant (idx_cso_validation_status) n'exclut que 'rejected'. On le remplace.
DROP INDEX IF EXISTS idx_cso_validation_status;

CREATE INDEX idx_cso_validation_status
  ON canonical_subject_occurrence (site_id, validation_status)
  WHERE validation_status NOT IN ('rejected', 'source_superseded');
