-- Migration 263 — Snapshots PDF épinglés pour la fiche visite historique.
--
-- Les snapshots de pages PDF (evidence_type='page_snapshot') peuvent être
-- sélectionnés dans la revue d'extraction pour être affichés dans la fiche
-- de la visite historique importée.
-- La colonne est nullable pour rétrocompatibilité ; le code TypeScript
-- l'interprète comme false si absente.

ALTER TABLE public.document_extraction_evidence
  ADD COLUMN IF NOT EXISTS pinned_for_visit boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.document_extraction_evidence.pinned_for_visit IS
  'Snapshot sélectionné pour être affiché dans la fiche de la visite historique (mig 263).';
