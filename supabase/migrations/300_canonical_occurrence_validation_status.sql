-- 300_canonical_occurrence_validation_status.sql
-- Ajoute validation_status sur canonical_subject_occurrence.
--
-- Sémantique (doctrine 2026-08-08) :
--   observed  — résolu automatiquement par l'IA (non encore promu par un humain)
--   confirmed — proposition promue/validée par un humain
--   rejected  — proposition explicitement écartée par un humain
--
-- visit_status reste inchangé : il décrit l'état MÉTIER observé dans la source
-- (field_checked / still_open / not_applicable / mentioned). Ce sont deux dimensions
-- orthogonales : l'une décrit CE QUI A ÉTÉ VU, l'autre le NIVEAU DE CONFIANCE.
--
-- Règle de priorité (appliquée dans le code, pas en DB) :
--   confirmed > observed  (une promotion ne peut pas rétrograder)
--   rejected  ne bouge que sur action humaine explicite (dismiss)

ALTER TABLE canonical_subject_occurrence
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'observed'
    CHECK (validation_status IN ('observed', 'confirmed', 'rejected'));

-- Backfill : toutes les occurrences existantes ont été créées via promoteProposal()
-- (la promotion humaine était la seule porte d'entrée avant ce lot).
-- Elles sont donc sémantiquement confirmed.
UPDATE canonical_subject_occurrence
SET validation_status = 'confirmed'
WHERE validation_status = 'observed';

-- Index pour les filtrages "état actif" (excluded rejected) dans les vues métier.
CREATE INDEX IF NOT EXISTS idx_cso_validation_status
  ON canonical_subject_occurrence (site_id, validation_status)
  WHERE validation_status != 'rejected';
