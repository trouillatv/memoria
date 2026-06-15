-- Clôture d'une action avec trace (2026-06-15)
--
-- Une action ne disparaît pas comme une case cochée : elle se CLÔTURE avec une
-- trace (commentaire + photo optionnelle) qui alimente la mémoire du chantier.
-- Doctrine : action ouverte = pilotage ; action terminée = fait accompli →
-- journal du site (jamais d'embedding / résonance pour un TODO).

ALTER TABLE public.site_actions
  ADD COLUMN IF NOT EXISTS completed_comment text,
  ADD COLUMN IF NOT EXISTS completed_photo_path text;

COMMENT ON COLUMN public.site_actions.completed_comment IS
  'Commentaire de clôture (« SudÉlec relancé, intervention jeudi »). Devient la trace au journal du site.';
COMMENT ON COLUMN public.site_actions.completed_photo_path IS
  'Photo de preuve optionnelle à la clôture (bucket intervention-photos, chemin site-actions/<id>/...).';
