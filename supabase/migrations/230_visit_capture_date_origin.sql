-- 230 — D'OÙ VIENT LA DATE D'UNE PIÈCE (Vincent, 2026-07-22)
--
-- `captured_at` porte l'instant RÉEL d'une pièce, mais il ne dit pas d'où cet
-- instant vient. Or il peut venir de quatre endroits très différents :
-- des métadonnées du fichier, du jour de la visite, du jour du dépôt, ou d'une
-- date saisie à la main.
--
-- « Ne fais pas croire que toutes les dates historiques proviennent des
--   métadonnées du fichier. » Sans cette colonne, l'écran devrait choisir une
-- formulation unique — et mentirait dans trois cas sur quatre.
--
-- NULL = on ne sait pas (toutes les captures antérieures, et le terrain direct,
-- où `captured_at` est nul et `created_at` fait foi). L'absence reste une
-- réponse : l'écran dira « versée le … », sans inventer une origine.

ALTER TABLE public.visit_capture
  ADD COLUMN IF NOT EXISTS captured_at_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visit_capture_captured_at_source_chk'
  ) THEN
    ALTER TABLE public.visit_capture
      ADD CONSTRAINT visit_capture_captured_at_source_chk
      CHECK (captured_at_source IS NULL OR captured_at_source IN ('file', 'visit', 'today', 'chosen'));
  END IF;
END $$;

COMMENT ON COLUMN public.visit_capture.captured_at_source IS
  'Origine de captured_at : file (métadonnées du fichier) | visit (jour de la visite) | today (jour du dépôt) | chosen (date saisie). NULL = inconnue.';
