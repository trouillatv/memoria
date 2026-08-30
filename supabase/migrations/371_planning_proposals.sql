-- Planning V1-B: proposal family dédiée et idempotence par proposition source.
ALTER TABLE document_extraction_proposal
  DROP CONSTRAINT IF EXISTS document_extraction_proposal_proposal_family_check;

ALTER TABLE document_extraction_proposal
  ADD CONSTRAINT document_extraction_proposal_proposal_family_check
  CHECK (proposal_family IN (
    'reservation','action','decision','observation','deadline',
    'knowledge_fact','person','company','planning'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS site_planning_items_source_proposal_uidx
  ON site_planning_items(source_proposal_id)
  WHERE source_proposal_id IS NOT NULL;
