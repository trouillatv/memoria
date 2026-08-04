-- 288 — Backfill provenance + fil thématique sur site_actions
--
-- Contexte : les actions créées via la matérialisation historique (import PV)
-- avaient report_id = null malgré l'existence des site_reports correspondants,
-- et subject_thread_id = null malgré les entrées document_proposal_materialization.
-- Ce bug de création est corrigé ici sans perte de données.
--
-- Chaîne de résolution :
--   site_actions.id
--     → document_proposal_materialization (target_entity_type='site_action')
--     → document_extraction_proposal.extraction_run_id / subject_thread_id
--     → site_reports.id (via extraction_run_id)

-- 1. Backfill report_id : restaure la traçabilité vers le PV source
UPDATE site_actions sa
SET report_id = (
  SELECT sr.id
  FROM document_proposal_materialization mat
  JOIN document_extraction_proposal dep ON dep.id = mat.proposal_id
  JOIN site_reports sr ON sr.extraction_run_id = dep.extraction_run_id
  WHERE mat.target_entity_id = sa.id
    AND mat.target_entity_type = 'site_action'
  LIMIT 1
)
WHERE sa.report_id IS NULL
  AND EXISTS (
    SELECT 1 FROM document_proposal_materialization mat2
    WHERE mat2.target_entity_id = sa.id
      AND mat2.target_entity_type = 'site_action'
  );

-- 2. Colonne subject_thread_id — fil thématique inter-PV (mig 268 pour proposal)
ALTER TABLE public.site_actions
  ADD COLUMN IF NOT EXISTS subject_thread_id UUID;

-- 3. Backfill subject_thread_id : permet la déduplication par fil
UPDATE site_actions sa
SET subject_thread_id = (
  SELECT dep.subject_thread_id
  FROM document_proposal_materialization mat
  JOIN document_extraction_proposal dep ON dep.id = mat.proposal_id
  WHERE mat.target_entity_id = sa.id
    AND mat.target_entity_type = 'site_action'
    AND dep.subject_thread_id IS NOT NULL
  LIMIT 1
)
WHERE sa.subject_thread_id IS NULL
  AND EXISTS (
    SELECT 1 FROM document_proposal_materialization mat2
    JOIN document_extraction_proposal dep2 ON dep2.id = mat2.proposal_id
    WHERE mat2.target_entity_id = sa.id
      AND mat2.target_entity_type = 'site_action'
      AND dep2.subject_thread_id IS NOT NULL
  );

-- 4. Index : lectures par fil sur un site donné
CREATE INDEX IF NOT EXISTS sa_thread_site_idx
  ON public.site_actions (site_id, subject_thread_id)
  WHERE subject_thread_id IS NOT NULL;
