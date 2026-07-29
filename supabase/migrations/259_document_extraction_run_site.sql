-- Migration 259 — Rattachement chantier cible sur document_extraction_run
--
-- La migration 257 avait placé target_site_id sur document_extraction_proposal
-- uniquement. L'action de matérialisation (review-actions.ts) lit target_site_id
-- depuis le run pour passer p_site_id à la RPC. Ce correctif ajoute la colonne
-- au niveau du run (source canonique du chantier cible).

ALTER TABLE public.document_extraction_run
  ADD COLUMN IF NOT EXISTS target_site_id uuid
    REFERENCES public.sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS doc_extraction_run_site_idx
  ON public.document_extraction_run(target_site_id)
  WHERE target_site_id IS NOT NULL;

COMMENT ON COLUMN public.document_extraction_run.target_site_id IS
  'Chantier cible de la matérialisation (p_site_id passé à materialize_historical_visit).';
