-- Étape courante de l'extraction — mise à jour au fil de l'exécution.
-- Permet d'afficher une barre de progression côté client.
ALTER TABLE public.document_extraction_run
  ADD COLUMN IF NOT EXISTS current_stage varchar(50);
