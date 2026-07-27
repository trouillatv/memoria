-- 243 — LA PHOTO PRINCIPALE D'UN CHANTIER (Vincent, 2026-07-27)
--
-- Aujourd'hui, la première photo venue tient lieu de vignette : le hasard
-- décide de l'image qui représente le chantier (liste, PDF, exports). Le
-- conducteur doit pouvoir CHOISIR celle qui raconte le mieux le site.
--
-- `cover_capture_id` pointe la capture retenue comme photo principale. Additif
-- et nullable : NULL = aucun choix (on retombe sur le comportement actuel).
-- ON DELETE SET NULL : si la capture disparaît, le chantier perd sa couverture
-- sans casser — il n'en désigne simplement plus.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS cover_capture_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sites_cover_capture_id_fkey'
  ) THEN
    ALTER TABLE public.sites
      ADD CONSTRAINT sites_cover_capture_id_fkey
      FOREIGN KEY (cover_capture_id) REFERENCES public.visit_capture(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.sites.cover_capture_id IS
  'Capture (visit_capture) choisie comme photo principale du chantier — vignette, PDF, exports. NULL = aucune, la première photo disponible fait foi.';
