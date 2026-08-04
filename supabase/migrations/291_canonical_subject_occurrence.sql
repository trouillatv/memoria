-- 291_canonical_subject_occurrence.sql
-- Occurrences terrain sur les sujets canoniques.
--
-- Phase V1 : source_kind = 'field_visit' uniquement.
-- Le pont PDF (historical_pdf) reste dans document_extraction_proposal.
-- La table est extensible : ajouter 'meeting', 'document' au CHECK en V2.
--
-- Doctrine :
--   - confirmation métier ≠ résolution canonique (elles sont indépendantes)
--   - une occurrence n'est créée que lorsque le sujet est résolu avec certitude
--   - ambiguous → needs_resolution, not_found → not_found (état explicit sur la proposition)

-- ── Table principale ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS canonical_subject_occurrence (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_subject_id   uuid        NOT NULL REFERENCES canonical_subject(id),
  site_id                uuid        NOT NULL REFERENCES sites(id),

  -- Provenance extensible (V1 : field_visit uniquement)
  source_kind            text        NOT NULL CHECK (source_kind IN ('field_visit')),
  source_ref_id          uuid        NOT NULL,   -- site_reports.id pour field_visit

  -- Clé d'idempotence : une seule occurrence par proposition terrain
  source_proposal_id     uuid        REFERENCES site_knowledge_proposals(id) ON DELETE SET NULL,
  UNIQUE (source_kind, source_proposal_id),

  -- État constaté (vocabulaire terrain propre, distinct du document_status PDF)
  visit_status           text        CHECK (visit_status IN (
                           'field_checked',   -- point vérifié pendant la visite
                           'still_open',      -- point toujours ouvert, confirmé
                           'not_applicable'   -- sans objet pour cette visite
                         )),

  label                  text        NOT NULL,
  note                   text,                   -- corps de la proposition (body)
  evidence_count         int         NOT NULL DEFAULT 0,

  effective_date         date        NOT NULL,   -- date de la visite

  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cso_canonical_subject ON canonical_subject_occurrence (canonical_subject_id);
CREATE INDEX IF NOT EXISTS idx_cso_site              ON canonical_subject_occurrence (site_id);
CREATE INDEX IF NOT EXISTS idx_cso_source_ref        ON canonical_subject_occurrence (source_ref_id);

ALTER TABLE canonical_subject_occurrence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read cso" ON canonical_subject_occurrence
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sites s
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE s.id = canonical_subject_occurrence.site_id
        AND om.user_id = auth.uid()
    )
  );

-- ── Colonnes de résolution sur site_knowledge_proposals ───────────────────────

ALTER TABLE site_knowledge_proposals
  ADD COLUMN IF NOT EXISTS canonical_subject_id uuid
    REFERENCES canonical_subject(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canonical_resolution_status text
    CHECK (canonical_resolution_status IN (
      'resolved',          -- occurrence terrain créée
      'needs_resolution',  -- ambiguïté : candidats dans payload.resolution_candidates
      'not_found'          -- aucun sujet canonique correspondant
    ));

CREATE INDEX IF NOT EXISTS idx_skp_resolution_status
  ON site_knowledge_proposals (site_id, canonical_resolution_status)
  WHERE canonical_resolution_status IS NOT NULL;
