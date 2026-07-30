-- Migration 265 : PK binaire (proposal_id, evidence_id) pour les associations photo.
--
-- Contexte : la PK ternaire (proposal_id, evidence_id, relation_type) permettait
-- plusieurs relations pour un même couple. Le modèle métier exige une décision unique
-- par couple : candidat, confirmé ou rejeté — jamais deux états simultanément.
--
-- La PK binaire garantit cet invariant en base et permet à l'extracteur d'utiliser
-- ON CONFLICT DO NOTHING pour ne jamais écraser une décision humaine existante.

-- Sécurité : supprimer les doublons candidats si un lien décisionnel existe déjà.
DELETE FROM public.document_proposal_evidence a
USING public.document_proposal_evidence b
WHERE a.proposal_id = b.proposal_id
  AND a.evidence_id = b.evidence_id
  AND a.relation_type = 'candidate'
  AND b.relation_type IN ('illustrates', 'dismissed');

-- Remplacer la PK ternaire par une PK binaire (une décision par couple).
ALTER TABLE public.document_proposal_evidence
  DROP CONSTRAINT document_proposal_evidence_pkey;

ALTER TABLE public.document_proposal_evidence
  ADD PRIMARY KEY (proposal_id, evidence_id);
