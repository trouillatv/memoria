-- 317_cso_historical_pdf.sql
--
-- Étend canonical_subject_occurrence pour les PV historiques (P0-B2).
--
-- Canal terrain (field_visit / meeting) :
--   Idempotence : UNIQUE (source_kind, source_proposal_id) — 1 occurrence par proposition
--   source_proposal_id → site_knowledge_proposals.id
--
-- Canal historique (historical_pdf) :
--   Idempotence : index UNIQUE PARTIEL (canonical_subject_id, source_ref_id) WHERE source_kind='historical_pdf'
--   → 1 occurrence par (sujet, rapport) quel que soit le nombre de propositions convergentes
--   source_proposal_id = NULL (document_extraction_proposal ≠ site_knowledge_proposals)
--
-- Invariant de coexistence :
--   Les deux canaux n'interfèrent pas : la contrainte terrain porte sur source_proposal_id (non NULL),
--   l'index historique porte sur (canonical_subject_id, source_ref_id) avec clause WHERE.
--   Une ligne field_visit avec source_proposal_id NULL ne déclenche PAS la contrainte historique.

-- ── 1. Étendre le CHECK de source_kind ───────────────────────────────────────

ALTER TABLE canonical_subject_occurrence
  DROP CONSTRAINT IF EXISTS canonical_subject_occurrence_source_kind_check;

ALTER TABLE canonical_subject_occurrence
  ADD CONSTRAINT canonical_subject_occurrence_source_kind_check
  CHECK (source_kind IN ('field_visit', 'meeting', 'historical_pdf'));

-- ── 2. Index UNIQUE PARTIEL pour l'idempotence du canal historique ────────────

CREATE UNIQUE INDEX IF NOT EXISTS cso_historical_pdf_uniq
  ON canonical_subject_occurrence (canonical_subject_id, source_ref_id)
  WHERE source_kind = 'historical_pdf';

-- ── 3. Index de recherche pour les requêtes par source_kind ──────────────────
-- Couvre les requêtes du moteur de relations qui fera IN ('field_visit','meeting','historical_pdf')

CREATE INDEX IF NOT EXISTS idx_cso_source_kind
  ON canonical_subject_occurrence (site_id, source_kind, effective_date DESC);

COMMENT ON INDEX cso_historical_pdf_uniq IS
  'Garantit une seule occurrence par (canonical_subject, rapport_historique). '
  'source_proposal_id peut être NULL pour ce canal (document_extraction_proposal ≠ site_knowledge_proposals).';
