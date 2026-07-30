-- Migration 264 : type de relation 'dismissed' pour les associations photo ↔ proposition
--
-- Contexte : quand l'utilisateur ignore une suggestion photo ↔ observation,
-- on conserve un enregistrement 'dismissed' plutôt que de supprimer le lien.
-- Cela évite que l'extracteur repropose le même lien lors d'une future régénération.
--
-- PK composite (proposal_id, evidence_id, relation_type) reste inchangée :
-- un même couple peut simultanément être 'candidate' et 'dismissed' sur des runs différents.
-- listCandidateLinksForRun filtre client-side les paires déjà rejetées.

alter table public.document_proposal_evidence
  drop constraint if exists document_proposal_evidence_relation_type_check;

alter table public.document_proposal_evidence
  add constraint document_proposal_evidence_relation_type_check
  check (relation_type in ('supports', 'illustrates', 'source', 'candidate', 'dismissed'));
