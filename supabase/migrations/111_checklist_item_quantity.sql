-- Checklist enrichie « à quantité » — preuve d'exécution déléguée (2026-06-16)
--
-- Pour les tâches confiées à un externe via lien partagé (/i/[token]) où le
-- COMPTE compte : livrer 12 plaques BA13, poser 4 rails… L'externe saisit la
-- quantité réellement livrée ; le statut est DÉRIVÉ des chiffres côté serveur.
--
-- Décision MVP (2026-06-16) : pas de colonne item_type. Un item est « à
-- quantité » SI expected_qty est renseigné. Une seule source de vérité, zéro
-- flag manuel qui pourrait contredire les chiffres.
--   expected_qty NULL      → item binaire classique (coche)
--   expected_qty NON NULL  → item à quantité (saisie d'un livré)
--
-- item_status dérivé : livré ≥ prévu → complet ; 0 < livré < prévu → partiel ;
--                      livré = 0 → non_livre. Jamais un dropdown manuel.
--
-- Frontière doctrinale : ceci est la preuve d'EXÉCUTION déléguée. La RÉCEPTION
-- fournisseur (bon de livraison) reste site_delivery (migration 109) — deux
-- sémantiques distinctes, on ne les fusionne pas.

ALTER TABLE public.intervention_checklist_items
  ADD COLUMN IF NOT EXISTS expected_qty  numeric,
  ADD COLUMN IF NOT EXISTS delivered_qty numeric,
  ADD COLUMN IF NOT EXISTS item_status   text;

ALTER TABLE public.intervention_checklist_items
  DROP CONSTRAINT IF EXISTS intervention_checklist_items_item_status_chk;
ALTER TABLE public.intervention_checklist_items
  ADD CONSTRAINT intervention_checklist_items_item_status_chk
  CHECK (item_status IS NULL OR item_status IN ('complet', 'partiel', 'non_livre'));

COMMENT ON COLUMN public.intervention_checklist_items.expected_qty IS
  'Quantité attendue. NULL = item binaire ; non NULL = item à quantité (preuve d''exécution déléguée).';
COMMENT ON COLUMN public.intervention_checklist_items.delivered_qty IS
  'Quantité réellement livrée/réalisée, saisie par l''externe via le token.';
COMMENT ON COLUMN public.intervention_checklist_items.item_status IS
  'Statut DÉRIVÉ des chiffres (complet / partiel / non_livre), jamais saisi manuellement.';
