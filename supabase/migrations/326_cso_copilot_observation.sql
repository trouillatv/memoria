-- 326_cso_copilot_observation.sql
--
-- P4-A — étend canonical_subject_occurrence pour les constats OBSERVATION du
-- Copilote (« Parler à MemorIA » — CAPTURER, Axe A). Un constat terrain saisi
-- hors visite/réunion planifiée (voix ou texte), daté implicitement à
-- aujourd'hui, sur un sujet canonique déjà résolu (résolution ambiguë ou
-- introuvable → aucune occurrence, jamais de création automatique).
--
-- Canal 'copilot' (comme 'historical_pdf', mig 317) : pas de ligne
-- site_knowledge_proposals — le Copilote 3C écrit directement dans les tables
-- domaine (site_actions, site_scheduled_events, visit_preparation...), jamais
-- via ce pont. source_proposal_id reste NULL ; l'idempotence porte sur
-- (canonical_subject_id, source_ref_id) avec source_ref_id = l'UUID du
-- brouillon Copilote (copilot_proposal_id), généré côté client à l'affichage.
--
-- visit_status reste NULL pour ce canal : un constat Copilote n'est ni un
-- point de checklist terrain (field_checked/still_open/not_applicable), ni
-- une mention de réunion (mentioned) — la valeur NULL est déjà légitime
-- (CHECK ... IS NULL OR ... depuis mig 292).

-- ── source_kind : élargir à 'copilot' ─────────────────────────────────────────

ALTER TABLE canonical_subject_occurrence
  DROP CONSTRAINT IF EXISTS canonical_subject_occurrence_source_kind_check;

ALTER TABLE canonical_subject_occurrence
  ADD CONSTRAINT canonical_subject_occurrence_source_kind_check
    CHECK (source_kind IN ('field_visit', 'meeting', 'historical_pdf', 'copilot'));

-- ── Idempotence canal copilot ──────────────────────────────────────────────────
-- Même principe que cso_historical_pdf_uniq (mig 317) : 1 occurrence par
-- (sujet, brouillon Copilote), source_proposal_id NULL pour ce canal.

CREATE UNIQUE INDEX IF NOT EXISTS cso_copilot_uniq
  ON canonical_subject_occurrence (canonical_subject_id, source_ref_id)
  WHERE source_kind = 'copilot';

COMMENT ON INDEX cso_copilot_uniq IS
  'Garantit une seule occurrence par (canonical_subject, brouillon Copilote). '
  'source_proposal_id reste NULL pour ce canal (pas de site_knowledge_proposals).';
